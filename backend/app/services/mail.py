"""Outgoing email through the company's own SMTP server. Without SMTP settings nothing is sent and callers are told so."""
import logging
import smtplib
from email.message import EmailMessage

from ..config import get_settings

log = logging.getLogger("platform.mail")
outbox: list[EmailMessage] = []  # used by the tests instead of a real server


def configured() -> bool:
    s = get_settings()
    return bool(s.smtp_host and s.smtp_from)


def send(to: str, subject: str, body: str) -> bool:
    s = get_settings()
    if not configured():
        return False
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = s.smtp_from, to, subject
    m.set_content(body)
    if s.env == "test":
        outbox.append(m)
        return True
    try:
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as c:
            c.starttls()
            if s.smtp_user:
                c.login(s.smtp_user, s.smtp_password)
            c.send_message(m)
        return True
    except (smtplib.SMTPException, OSError):
        log.exception("email could not be sent", extra={"to_domain": to.split("@")[-1]})
        return False
