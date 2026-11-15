"""Bounded decoding for plain or gzip-encoded private S3 JSON objects."""
import gzip
import io
import json
import zlib

MAX_WIRE_BYTES = 256 * 1024
MAX_JSON_BYTES = 256 * 1024


def read_json_object(body, content_encoding=None):
    """Consume and close a GetObject body; limits apply before AND after inflation."""
    try:
        wire = body.read(MAX_WIRE_BYTES + 1)
    finally:
        body.close()
    if len(wire) > MAX_WIRE_BYTES:
        raise RuntimeError("Curated object exceeds wire size limit")
    encoding = (content_encoding or "identity").strip().lower()
    if encoding not in ("identity", "gzip"):
        raise RuntimeError("Unsupported curated object encoding")
    try:
        if encoding == "gzip":
            with gzip.GzipFile(fileobj=io.BytesIO(wire), mode="rb") as stream:
                decoded = stream.read(MAX_JSON_BYTES + 1)
        else:
            decoded = wire
    except (OSError, EOFError, zlib.error) as exc:
        raise RuntimeError("Invalid compressed curated object") from exc
    if len(decoded) > MAX_JSON_BYTES:
        raise RuntimeError("Curated JSON exceeds decoded size limit")
    try:
        value = json.loads(decoded)
    except (ValueError, UnicodeError) as exc:
        raise RuntimeError("Invalid curated JSON object") from exc
    if not isinstance(value, dict):
        raise RuntimeError("Curated JSON must be an object")
    return value
