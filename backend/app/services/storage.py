"""Where file bytes are kept. Everything else talks to the `Storage` interface, so the backend can be changed (another disk, an S3-compatible
store) without touching the rest. Keys are random names made by us; nothing a person types ever becomes part of a path."""
import contextlib
import os
import re
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO, Protocol

_KEY = re.compile(r"^[a-f0-9]{48}$")


class Storage(Protocol):
    def writer(self, key: str) -> "Writer": ...
    def open(self, key: str) -> BinaryIO: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...


class Writer(Protocol):
    def write(self, chunk: bytes) -> None: ...
    def commit(self) -> None: ...
    def abort(self) -> None: ...


class LocalStorage:
    """Files on the server's own disk, readable only by the service's user. A file appears under its key only when completely written."""

    def __init__(self, root: str):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def _path(self, key: str) -> Path:
        if not _KEY.match(key):
            raise ValueError("bad storage key")
        p = (self.root / key[:2] / key[2:4] / key).resolve()
        if self.root not in p.parents:  # cannot happen with a checked key; kept as a second lock
            raise ValueError("path escapes the storage directory")
        return p

    def writer(self, key: str):
        final = self._path(key)
        final.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        tmp = final.with_suffix(".part")
        fh = os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb")

        class _W:
            def write(self, chunk: bytes):
                fh.write(chunk)

            def commit(self):
                fh.flush()
                os.fsync(fh.fileno())
                fh.close()
                os.replace(tmp, final)

            def abort(self):
                with contextlib.suppress(OSError):
                    fh.close()
                with contextlib.suppress(OSError):
                    tmp.unlink()
        return _W()

    def open(self, key: str) -> BinaryIO:
        return self._path(key).open("rb")

    def delete(self, key: str) -> None:
        with contextlib.suppress(FileNotFoundError):
            self._path(key).unlink()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()


class MemoryStorage:
    """Keeps bytes in memory. Used by the tests to prove nothing depends on the local disk."""

    def __init__(self):
        self.blobs: dict[str, bytes] = {}

    def writer(self, key: str):
        buf, blobs = bytearray(), self.blobs

        class _W:
            def write(self, chunk: bytes):
                buf.extend(chunk)

            def commit(self):
                blobs[key] = bytes(buf)

            def abort(self):
                buf.clear()
        return _W()

    def open(self, key: str):
        import io
        return io.BytesIO(self.blobs[key])

    def delete(self, key: str) -> None:
        self.blobs.pop(key, None)

    def exists(self, key: str) -> bool:
        return key in self.blobs


_current: Storage | None = None


def get_storage() -> Storage:
    global _current
    if _current is None:
        from ..config import get_settings
        _current = LocalStorage(get_settings().files_dir)
    return _current


def set_storage(s: Storage | None):
    global _current
    _current = s


def chunks(fh: BinaryIO, size: int = 65536) -> Iterator[bytes]:
    try:
        while True:
            b = fh.read(size)
            if not b:
                return
            yield b
    finally:
        fh.close()
