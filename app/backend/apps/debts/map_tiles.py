"""Файл подложки карты. В Docker его отдаёт NGINX, здесь — локальный запуск без контейнера.

PMTiles читает архив кусками. Обычный FileResponse отдал бы все ~700 МБ на каждый запрос.
"""

import re
from pathlib import Path

from django.conf import settings
from django.http import Http404, HttpResponse, StreamingHttpResponse

MAP_FILE = "belarus.pmtiles"
_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
_BLOCK = 64 * 1024


def belarus_map(request, filename: str):
    if filename != MAP_FILE:
        raise Http404
    path = Path(settings.BASE_DIR).parent / "maps" / MAP_FILE
    if not path.is_file():
        raise Http404
    size = path.stat().st_size
    header = request.headers.get("Range", "")
    if request.method == "HEAD" and not header:
        response = HttpResponse(content_type="application/octet-stream")
        response["Accept-Ranges"] = "bytes"
        response["Content-Length"] = str(size)
        return response
    start, end = _bounds(header, size)
    if start is None:
        response = HttpResponse(status=416, content_type="application/octet-stream")
        response["Content-Range"] = f"bytes */{size}"
        response["Accept-Ranges"] = "bytes"
        return response
    length = end - start + 1
    handle = path.open("rb")
    handle.seek(start)
    response = StreamingHttpResponse(
        _chunks(handle, length),
        status=206 if header else 200,
        content_type="application/octet-stream",
    )
    response["Accept-Ranges"] = "bytes"
    response["Content-Length"] = str(length)
    if header:
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
    return response


def _bounds(header: str, size: int) -> tuple[int, int] | tuple[None, None]:
    if not header:
        return 0, size - 1
    match = _RANGE.match(header.strip())
    if match is None or size <= 0:
        return None, None
    start_raw, end_raw = match.group(1), match.group(2)
    if start_raw == "" and end_raw == "":
        return None, None
    if start_raw == "":
        suffix = int(end_raw)
        if suffix <= 0:
            return None, None
        return max(size - suffix, 0), size - 1
    start = int(start_raw)
    end = int(end_raw) if end_raw else size - 1
    if start >= size or start > end:
        return None, None
    return start, min(end, size - 1)


def _chunks(handle, length: int):
    remaining = length
    try:
        while remaining:
            block = handle.read(min(_BLOCK, remaining))
            if not block:
                break
            remaining -= len(block)
            yield block
    finally:
        handle.close()
