"""Маршрут до контура АИС ПРИС.

itVPN поднимает заказчик на сервере. Приложение туннель не создаёт:
шлюз открывает TCP до адреса из GW_PRIS_BASE_URL и по этому маршруту
уже ходит HttpPrisClient. На Linux после NAT Docker пакет уходит
в таблицу маршрутов хоста. Если туннель ловит только свои процессы
и не пропускает пересланный трафик, порт с контейнера не откроется.
"""

import asyncio
from urllib.parse import urlsplit


async def probe_pris_route(base_url: str, timeout: float = 3.0) -> dict:
    parsed = urlsplit((base_url or "").strip())
    host = parsed.hostname or ""
    if parsed.scheme not in {"http", "https"} or not host:
        return {
            "up": False,
            "host": host,
            "port": 0,
            "detail": "GW_PRIS_BASE_URL должен быть http-адресом контура.",
        }
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        _reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
    except TimeoutError:
        return {
            "up": False,
            "host": host,
            "port": port,
            "detail": (
                f"Нет ответа от {host}:{port}. "
                "Туннель itVPN на сервере не пускает шлюз к контуру."
            ),
        }
    except OSError:
        return {
            "up": False,
            "host": host,
            "port": port,
            "detail": (
                f"Маршрута до {host}:{port} нет. Туннель itVPN на сервере не поднят."
            ),
        }
    writer.close()
    try:
        await writer.wait_closed()
    except OSError:
        pass
    return {
        "up": True,
        "host": host,
        "port": port,
        "detail": (
            f"Шлюз открыл порт {host}:{port}. "
            "Маршрут itVPN с этой машины до контура есть."
        ),
    }
