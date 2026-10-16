"""Кадры Asterisk AMI: строки `Ключ: значение`, сообщение заканчивается пустой строкой."""

from __future__ import annotations


def ami_text(value: str) -> str:
    """Одна строка AMI. Перевод строки оборвал бы кадр."""
    return (value or "").replace("\r", " ").replace("\n", " ").strip()


def encode_frame(fields: list[tuple[str, str]]) -> bytes:
    lines = [f"{key}: {ami_text(value)}" for key, value in fields]
    return ("\r\n".join(lines) + "\r\n\r\n").encode("utf-8")


def parse_frame(raw: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip()
    return fields
