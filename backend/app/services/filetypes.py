"""Decides what a file is by looking at its first bytes, never by trusting its name or the type the sender claims."""
import zipfile
from io import BytesIO

# detected type -> extensions it may carry
ALLOWED: dict[str, tuple[str, ...]] = {
    "image/jpeg": ("jpg", "jpeg"), "image/png": ("png",), "image/webp": ("webp",), "image/gif": ("gif",),
    "application/pdf": ("pdf",),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ("xlsx",),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ("docx",),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ("pptx",),
    "text/csv": ("csv",), "text/plain": ("txt",),
}
INLINE = {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}  # safe to show in the browser; everything else downloads
_OFFICE = {"xl/": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "word/": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
           "ppt/": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}


def extension(name: str) -> str:
    return name.rsplit(".", 1)[1].lower() if "." in name else ""


def sniff(head: bytes, whole: bytes | None, name: str) -> str | None:
    """Returns the detected type, or None when the content is not one we accept. `whole` is given for small files so a zip can be opened."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"PK\x03\x04"):
        if whole is None:
            return None
        try:
            names = zipfile.ZipFile(BytesIO(whole)).namelist()
        except zipfile.BadZipFile:
            return None
        if "[Content_Types].xml" not in names or any(n.lower().endswith((".bin", ".exe", ".dll")) and "vbaProject" in n for n in names):
            return None  # not an Office document, or one carrying macros
        return next((t for prefix, t in _OFFICE.items() if any(n.startswith(prefix) for n in names)), None)
    # Text: must decode as UTF-8, have no control bytes, and not be markup or script a browser might run.
    try:
        text = head.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = head[:-3].decode("utf-8")  # a multi-byte character may be cut at the end of the sample
        except UnicodeDecodeError:
            return None
    if any(ord(c) < 9 or 13 < ord(c) < 32 for c in text):
        return None
    low = text.lstrip("﻿ \t\r\n").lower()
    if low.startswith(("<", "#!", "%!")) or "<script" in low or "<html" in low or "<svg" in low:
        return None
    return "text/csv" if extension(name) == "csv" else "text/plain"


def check(head: bytes, whole: bytes | None, name: str) -> tuple[str | None, str]:
    """(type, "") when acceptable, otherwise (None, reason)."""
    t = sniff(head, whole, name)
    if t is None:
        return None, "This kind of file is not accepted. Allowed: JPG, PNG, WEBP, GIF, PDF, XLSX, DOCX, PPTX, CSV, TXT."
    if extension(name) not in ALLOWED[t]:
        return None, f"The file's content is {t.split('/')[-1].upper() if '/' in t else t}, which does not match its name ending '.{extension(name) or '?'}'."
    return t, ""
