"""Chat between people of the company. Messages are stored; each one is announced on every member's own channel."""
import uuid

from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from ..db import SCHEMA
from ..deps import Principal
from ..errors import ApiError
from ..models.realtime import ChatMember, ChatMessage, ChatRoom
from .events import emit

MAX_TEXT, MAX_MEMBERS = 4000, 50
PERM = "chat.use"


def _room(db: Session, p: Principal, room_id: str) -> ChatRoom:
    try:
        rid = uuid.UUID(str(room_id))
    except ValueError as e:
        raise ApiError(404, "This conversation does not exist.", "not_found") from e
    room = db.get(ChatRoom, rid)
    # A room you are not in looks exactly like one that does not exist.
    if room is None or not db.get(ChatMember, (rid, p.id)):
        raise ApiError(404, "This conversation does not exist.", "not_found")
    return room


def members(db: Session, room_id) -> list[int]:
    return list(db.scalars(select(ChatMember.user_id).where(ChatMember.room_id == room_id)))


def open_room(db: Session, p: Principal, user_ids: list[int], name: str | None) -> ChatRoom:
    if not p.can(PERM):
        raise ApiError(403, "Your role does not include chat.", "forbidden")
    others = sorted({int(u) for u in user_ids if int(u) != p.id})
    if not others or len(others) + 1 > MAX_MEMBERS:
        raise ApiError(422, f"Choose between 1 and {MAX_MEMBERS - 1} other people.", "invalid_request")
    found = {r[0] for r in db.execute(text("select id from public.users where id = any(:u) and active"), {"u": others})}
    if found != set(others):
        raise ApiError(422, "One of the people chosen does not exist or is not active.", "invalid_request")
    if len(others) == 1 and not name:
        key = f"{min(p.id, others[0])}:{max(p.id, others[0])}"
        room = db.scalar(select(ChatRoom).where(ChatRoom.direct_key == key))
        if room:
            return room
        room = ChatRoom(kind="direct", direct_key=key, created_by=p.id)
    else:
        room = ChatRoom(kind="group", name=(name or "Group").strip()[:80], created_by=p.id)
    db.add(room)
    db.flush()
    db.add_all([ChatMember(room_id=room.id, user_id=u) for u in [p.id, *others]])
    db.flush()
    for u in [p.id, *others]:
        emit(db, f"user:{u}", "chat.room", {"room": str(room.id)})
    return room


def message_view(m: ChatMessage) -> dict:
    return {"id": m.id, "room": str(m.room_id), "sender_id": m.sender_id, "text": m.body, "client_id": m.client_id, "at": m.created_at.isoformat() if m.created_at else None}


def send(db: Session, p: Principal, room_id: str, body, client_id=None) -> dict:
    if not p.can(PERM):
        raise ApiError(403, "Your role does not include chat.", "forbidden")
    room = _room(db, p, room_id)
    body = body.strip() if isinstance(body, str) else ""
    if not body or len(body) > MAX_TEXT:
        raise ApiError(422, f"A message needs text, at most {MAX_TEXT} characters.", "invalid_request")
    cid = str(client_id)[:64] if client_id else None
    if cid:  # the same message sent again after a lost connection: answer with the one already stored
        had = db.scalar(select(ChatMessage).where(ChatMessage.sender_id == p.id, ChatMessage.client_id == cid))
        if had:
            return message_view(had)
    m = ChatMessage(room_id=room.id, sender_id=p.id, body=body, client_id=cid)
    db.add(m)
    db.flush()
    db.refresh(m)
    room.last_message_at = m.created_at
    db.execute(update(ChatMember).where(ChatMember.room_id == room.id, ChatMember.user_id == p.id).values(last_read_id=m.id, last_delivered_id=m.id))
    out = message_view(m)
    for u in members(db, room.id):
        emit(db, f"user:{u}", "chat.message", {**out, "sender": p.name})
    return out


def _receipt(db: Session, room_id, user_id: int):
    mem = db.get(ChatMember, (room_id, user_id))
    for u in members(db, room_id):
        emit(db, f"user:{u}", "chat.receipt", {"room": str(room_id), "user_id": user_id, "delivered_id": mem.last_delivered_id, "read_id": mem.last_read_id},
             dedupe_key=f"rcpt:{room_id}:{user_id}:{mem.last_delivered_id}:{mem.last_read_id}:{u}")


def mark_delivered(db: Session, user_id: int, room_id: str, message_id: int):
    rid = uuid.UUID(str(room_id))
    done = db.execute(update(ChatMember).where(ChatMember.room_id == rid, ChatMember.user_id == user_id, ChatMember.last_delivered_id < message_id).values(last_delivered_id=message_id).returning(ChatMember.user_id)).first()
    if done:
        _receipt(db, rid, user_id)


def mark_read(db: Session, p: Principal, room_id: str, upto) -> None:
    room = _room(db, p, room_id)
    top = db.scalar(select(func.max(ChatMessage.id)).where(ChatMessage.room_id == room.id)) or 0
    upto = min(int(upto), top) if isinstance(upto, int) and not isinstance(upto, bool) else top
    done = db.execute(update(ChatMember).where(ChatMember.room_id == room.id, ChatMember.user_id == p.id, ChatMember.last_read_id < upto)
                      .values(last_read_id=upto, last_delivered_id=func.greatest(ChatMember.last_delivered_id, upto)).returning(ChatMember.user_id)).first()
    if done:
        _receipt(db, room.id, p.id)


def history(db: Session, p: Principal, room_id: str, before: int | None, limit: int) -> dict:
    room = _room(db, p, room_id)
    q = select(ChatMessage).where(ChatMessage.room_id == room.id).order_by(ChatMessage.id.desc()).limit(max(1, min(limit, 100)))
    if before:
        q = q.where(ChatMessage.id < before)
    rows = list(db.scalars(q))
    # Fetching the history is also proof the messages reached this person.
    if rows:
        mark_delivered(db, p.id, str(room.id), rows[0].id)
    mems = db.execute(text(f"select m.user_id, u.name, m.last_delivered_id, m.last_read_id from {SCHEMA}.chat_members m join public.users u on u.id = m.user_id where m.room_id = :r order by u.name"), {"r": room.id}).mappings().all()  # noqa: S608
    return {"room": {"id": str(room.id), "kind": room.kind, "name": room.name}, "members": [dict(m) for m in mems], "messages": [message_view(m) for m in reversed(rows)]}


def rooms(db: Session, p: Principal) -> list[dict]:
    rows = db.execute(text(f"""
        select r.id, r.kind, r.name, r.last_message_at, me.last_read_id,
               (select count(*) from {SCHEMA}.chat_messages x where x.room_id = r.id and x.id > me.last_read_id and x.sender_id <> :me) as unread,
               (select json_build_object('id', x.id, 'text', left(x.body, 120), 'sender_id', x.sender_id, 'at', x.created_at) from {SCHEMA}.chat_messages x where x.room_id = r.id order by x.id desc limit 1) as last,
               (select json_agg(json_build_object('id', u.id, 'name', u.name) order by u.name) from {SCHEMA}.chat_members m join public.users u on u.id = m.user_id where m.room_id = r.id) as members
          from {SCHEMA}.chat_rooms r join {SCHEMA}.chat_members me on me.room_id = r.id and me.user_id = :me
         order by r.last_message_at desc nulls last, r.created_at desc limit 200"""), {"me": p.id}).mappings().all()  # noqa: S608
    return [{**r, "id": str(r["id"]), "title": r["name"] or ", ".join(m["name"] for m in r["members"] if m["id"] != p.id)} for r in rows]
