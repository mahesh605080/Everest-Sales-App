from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import Principal, current, super_admin
from ..errors import ApiError
from ..realtime.hub import hub
from ..services import chat
from ..services import events as ev

router = APIRouter(tags=["realtime and chat"])


class PublishIn(BaseModel):
    channel: str = Field(max_length=120)
    event: str = Field(pattern=r"^[a-z][a-z0-9_.]{1,59}$")
    payload: dict = Field(default_factory=dict)
    dedupe_key: str | None = Field(None, max_length=160)


@router.post("/realtime/publish", summary="Send an event to a channel (Super Admin). Announcements go to the channel 'all'.")
def publish(body: PublishIn, _: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    if not ev._CH.match(body.channel):
        raise ApiError(422, "Unknown channel. Use all, user:<id>, role:<key>, area:<id>, region:<id> or data:<collection>.", "invalid_request")
    try:
        eid = ev.emit(db, body.channel, body.event, body.payload, body.dedupe_key)
    except ValueError as e:
        raise ApiError(413, "The payload is too large (8 KB at most).", "too_large") from e
    return {"id": eid, "duplicate": eid is None}


@router.get("/realtime/events", summary="Events of a channel after a given id: the same catch-up a reconnecting socket gets, for clients that poll")
def events(channel: str, since: int = Query(0, ge=0), p: Principal = Depends(current()), db: Session = Depends(get_db)):
    if not ev.may_subscribe(db, p, channel):
        raise ApiError(403, "You may not listen to this channel.", "forbidden")
    return {"events": ev.replay(db, channel, since), "last_event_id": ev.last_id(db)}


@router.get("/realtime/presence", summary="Which of the given people have a live connection now")
def presence(users: str = Query(..., max_length=2000), _: Principal = Depends(current())):
    try:
        ids = [int(x) for x in users.split(",") if x.strip()][:200]
    except ValueError as e:
        raise ApiError(422, "users must be a list of numbers.", "invalid_request") from e
    return {"online": {str(k): v for k, v in hub.online(ids).items()}}


@router.get("/admin/realtime", summary="Live connection figures")
def stats(_: Principal = Depends(super_admin)):
    return hub.snapshot()


class RoomIn(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=49)
    name: str | None = Field(None, max_length=80)


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    client_id: str | None = Field(None, max_length=64)


@router.get("/chat/people", summary="Colleagues who can be written to: name and role only")
def people(q: str = Query("", max_length=60), p: Principal = Depends(current()), db: Session = Depends(get_db)):
    like = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    rows = db.execute(text("""select u.id, u.name, u.code, r.name as role from public.users u join public.roles r on r.id = u.role_id
                               where u.active and u.id <> :me and r.permissions ? 'chat.use' and (u.name ilike :q or u.code ilike :q) order by u.name limit 50"""), {"me": p.id, "q": like}).mappings().all()
    live = hub.online([r["id"] for r in rows])
    return {"people": [{**r, "online": live.get(r["id"], False)} for r in rows]}


@router.get("/chat/rooms", summary="This person's conversations with unread counts and the last message")
def my_rooms(p: Principal = Depends(current()), db: Session = Depends(get_db)):
    rs = chat.rooms(db, p)
    live = hub.online([m["id"] for r in rs for m in r["members"]])
    return {"rooms": [{**r, "members": [{**m, "online": live.get(m["id"], False)} for m in r["members"]]} for r in rs]}


@router.post("/chat/rooms", summary="Open a conversation. With one other person and no name, the existing direct conversation is returned.")
def open_room(body: RoomIn, p: Principal = Depends(current()), db: Session = Depends(get_db)):
    r = chat.open_room(db, p, body.user_ids, body.name)
    return {"id": str(r.id), "kind": r.kind, "name": r.name}


@router.get("/chat/rooms/{room_id}/messages", summary="A page of messages, newest last. Fetching them marks them delivered.")
def messages(room_id: str, p: Principal = Depends(current()), db: Session = Depends(get_db), before: int | None = Query(None, ge=1), limit: int = Query(50, ge=1, le=100)):
    return chat.history(db, p, room_id, before, limit)


@router.post("/chat/rooms/{room_id}/messages", status_code=201, summary="Send a message. A repeated client_id returns the message already stored.")
def post_message(room_id: str, body: MessageIn, p: Principal = Depends(current()), db: Session = Depends(get_db)):
    return chat.send(db, p, room_id, body.text, body.client_id)


@router.post("/chat/rooms/{room_id}/read", summary="Mark a conversation read up to a message")
def read(room_id: str, p: Principal = Depends(current()), db: Session = Depends(get_db), upto: int | None = None):
    chat.mark_read(db, p, room_id, upto)
    return {"ok": True}
