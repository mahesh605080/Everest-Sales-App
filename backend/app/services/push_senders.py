"""Hands an encrypted message to a device's push service. One function per channel, all returning the same small result,
so the queue does not care which one it used."""
import json
import logging
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
import jwt
from pywebpush import WebPushException, webpush

from ..config import get_settings

log = logging.getLogger("platform.push")


@dataclass
class Result:
    ok: bool
    status: int | None = None
    gone: bool = False          # the subscription no longer exists: stop using it
    retry: bool = False         # worth trying again later
    retry_after: int | None = None
    error: str | None = None


def allowed_endpoint(url: str) -> bool:
    try:
        u = urlsplit(url)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h or host.endswith("." + h) for h in (x.strip().lower() for x in get_settings().push_hosts.split(",")) if h)


def _classify(status: int, retry_after: str | None, text: str) -> Result:
    if 200 <= status < 300:
        return Result(ok=True, status=status)
    if status in (404, 410):
        return Result(ok=False, status=status, gone=True, error="subscription no longer valid")
    if status == 429 or status >= 500:
        ra = int(retry_after) if retry_after and retry_after.isdigit() else None
        return Result(ok=False, status=status, retry=True, retry_after=ra, error=f"push service answered {status}")
    return Result(ok=False, status=status, error=f"push service refused it ({status}): {text[:120]}")


def send_webpush(sub, payload: dict, ttl: int, urgent: bool) -> Result:
    s = get_settings()
    if not s.webpush_ready:
        return Result(ok=False, error="web push is not configured (VAPID keys missing)")
    if not allowed_endpoint(sub.endpoint):
        return Result(ok=False, gone=True, error="endpoint is not a known push service")
    try:
        r = webpush(subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}, data=json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(),
                    vapid_private_key=s.vapid_private_key, vapid_claims={"sub": s.vapid_subject}, ttl=max(0, ttl), headers={"Urgency": "high" if urgent else "normal"}, timeout=10)
        return _classify(r.status_code, r.headers.get("retry-after"), r.text)
    except WebPushException as e:
        if e.response is not None:
            if e.response.status_code == 403:
                # The push service says this subscription was made for a different server key (ours was changed). The browser makes a new one on its next visit.
                return Result(ok=False, status=403, gone=True, error="made with an older server key")
            return _classify(e.response.status_code, e.response.headers.get("retry-after"), e.response.text)
        return Result(ok=False, retry=True, error="could not reach the push service")
    except Exception as e:  # bad keys from the browser, network trouble
        bad_key = isinstance(e, ValueError | TypeError)
        return Result(ok=False, gone=bad_key, retry=not bad_key, error="subscription keys are not valid" if bad_key else "could not reach the push service")


_apns_token: tuple[float, str] | None = None


def _apns_jwt() -> str:
    global _apns_token
    s = get_settings()
    if _apns_token and time.time() - _apns_token[0] < 3000:  # Apple wants the token reused for up to an hour
        return _apns_token[1]
    tok = jwt.encode({"iss": s.apns_team_id, "iat": int(time.time())}, s.apns_key.replace("\\n", "\n"), algorithm="ES256", headers={"kid": s.apns_key_id})
    _apns_token = (time.time(), tok)
    return tok


def send_apns(sub, payload: dict, ttl: int, urgent: bool) -> Result:
    """Directly to Apple's push service over HTTP/2. No Firebase, no other relay."""
    s = get_settings()
    if not s.apns_ready:
        return Result(ok=False, error="APNs is not configured")
    host = "api.sandbox.push.apple.com" if s.apns_sandbox else "api.push.apple.com"
    body = {"aps": {"alert": {"title": payload["title"], "body": payload.get("body") or ""}, "sound": "default", "thread-id": payload.get("category", "general")}, "url": payload.get("url"), "id": payload.get("id"), "ack": payload.get("ack")}
    try:
        with httpx.Client(http2=True, timeout=10) as c:
            r = c.post(f"https://{host}/3/device/{sub.endpoint}", json=body, headers={"authorization": f"bearer {_apns_jwt()}", "apns-topic": s.apns_topic, "apns-push-type": "alert",
                                                                                     "apns-priority": "10" if urgent else "5", "apns-expiration": str(int(time.time()) + max(0, ttl)),
                                                                                     **({"apns-collapse-id": str(payload["id"])[:64]} if payload.get("id") else {})})   # a repeat replaces, never doubles
    except httpx.HTTPError:
        return Result(ok=False, retry=True, error="could not reach Apple's push service")
    if r.status_code == 200:
        return Result(ok=True, status=200)
    reason = (r.json().get("reason") if r.headers.get("content-type", "").startswith("application/json") else "") or ""
    if r.status_code == 410 or reason in ("BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"):
        return Result(ok=False, status=r.status_code, gone=True, error=f"Apple: {reason or 'token no longer valid'}")
    return _classify(r.status_code, r.headers.get("retry-after"), reason)


SENDERS = {"webpush": send_webpush, "apns": send_apns}
