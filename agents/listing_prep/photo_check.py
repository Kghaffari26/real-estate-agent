"""Server-side photo checks before anything reaches the model (owner review, 2026-10-01).

The Desk re-encodes photos in the browser, which drops EXIF (camera GPS, device,
timestamps). The worker doesn't trust that: it decodes every stored file itself, and a
file that still carries EXIF or GPS data is rejected and its stored copy deleted (it
can only get there by bypassing the Desk). What the model sees is always a fresh
re-encode of the pixels alone, at most `MODEL_MAX_EDGE` on the long edge.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

# Long edge for the model: past ~1568 px the API downscales anyway, so larger only costs.
MODEL_MAX_EDGE = 1568
GPS_IFD = 0x8825
ACCEPTED_FORMATS = frozenset({"JPEG", "WEBP"})
# Decompression-bomb guard: the Desk uploads at most 2048 x 2048.
MAX_PIXELS = 4096 * 4096


@dataclass(frozen=True)
class PhotoCheck:
    ok: bool
    format: str | None
    width: int
    height: int
    has_exif: bool
    has_gps: bool
    reason: str | None = None  # "metadata" | "unreadable" | "format"


def inspect(data: bytes) -> PhotoCheck:
    """Decode and inspect a stored photo. `ok` only for a readable JPEG/WebP without EXIF."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.width * img.height > MAX_PIXELS:
                return PhotoCheck(False, img.format, img.width, img.height, False, False, "unreadable")
            fmt = img.format
            exif = img.getexif()
            has_gps = bool(exif.get_ifd(GPS_IFD)) if exif else False
            has_exif = bool(exif) or "exif" in img.info
            img.load()
            width, height = img.size
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return PhotoCheck(False, None, 0, 0, False, False, "unreadable")
    if fmt not in ACCEPTED_FORMATS:
        return PhotoCheck(False, fmt, width, height, has_exif, has_gps, "format")
    if has_exif or has_gps:
        return PhotoCheck(False, fmt, width, height, has_exif, has_gps, "metadata")
    return PhotoCheck(True, fmt, width, height, False, False)


def for_model(data: bytes, max_edge: int = MODEL_MAX_EDGE) -> bytes:
    """Pixels only: decode, apply the orientation, fit within `max_edge`, re-encode as a
    JPEG with no metadata."""
    with Image.open(io.BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85, optimize=True)  # no exif= → none written
        return out.getvalue()
