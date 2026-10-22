"""Отсоединённая подпись PKCS#7, которую ставит плагин AvCMXWebP.

Криптографию СТБ и сверку со списком отозванных сертификатов выполняет
«Комплект абонента АВЕСТ» на рабочем месте с носителем AvPass. Здесь
проверяется форма: это SignedData, содержимое PDF в подпись не вложено,
сертификат подписанта вложен. Локальная отметка пакета сюда не проходит.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass

STUB_MARK = b"STUB-PACKAGE-SIGNATURE"
SIGNED_DATA_OID = (1, 2, 840, 113549, 1, 7, 2)
DATA_OID = (1, 2, 840, 113549, 1, 7, 1)
_OID_LABELS = {
    (2, 5, 4, 3): "CN",
    (2, 5, 4, 6): "C",
    (2, 5, 4, 7): "L",
    (2, 5, 4, 8): "ST",
    (2, 5, 4, 10): "O",
    (2, 5, 4, 11): "OU",
    (2, 5, 4, 12): "T",
    (1, 2, 112, 1, 2, 1, 1, 1, 1, 2): "UNP",
}


class Pkcs7Error(ValueError):
    """Файл не является отсоединённой подписью PKCS#7."""


@dataclass(frozen=True)
class DetachedSignature:
    der: bytes
    subject: str
    issuer: str


class _Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.i = 0

    def remaining(self) -> int:
        return len(self.data) - self.i

    def _read(self, size: int) -> bytes:
        if size < 0 or self.i + size > len(self.data):
            raise Pkcs7Error("файл ЭЦП обрывается")
        chunk = self.data[self.i:self.i + size]
        self.i += size
        return chunk

    def take(self) -> tuple[int, bytes]:
        if self.i >= len(self.data):
            raise Pkcs7Error("файл ЭЦП обрывается")
        tag = self.data[self.i]
        self.i += 1
        if self.i >= len(self.data):
            raise Pkcs7Error("файл ЭЦП обрывается")
        first = self.data[self.i]
        self.i += 1
        if first < 0x80:
            return tag, self._read(first)
        if first == 0x80:
            chunks: list[bytes] = []
            while True:
                if self.i + 1 >= len(self.data):
                    raise Pkcs7Error("файл ЭЦП обрывается")
                if self.data[self.i] == 0 and self.data[self.i + 1] == 0:
                    self.i += 2
                    break
                start = self.i
                self.take()
                chunks.append(self.data[start:self.i])
            return tag, b"".join(chunks)
        count = first & 0x7F
        if count == 0 or count > 4:
            raise Pkcs7Error("файл ЭЦП не PKCS#7 SignedData")
        length = int.from_bytes(self._read(count), "big")
        return tag, self._read(length)


def inspect_detached_pkcs7(payload: bytes) -> DetachedSignature:
    """Принимает DER или Base64. Возвращает DER и имена из первого сертификата."""
    der = _unwrap(payload)
    reader = _Reader(der)
    tag, body = reader.take()
    if tag != 0x30 or reader.remaining():
        raise Pkcs7Error("файл ЭЦП не PKCS#7 SignedData")
    parts = _children(body)
    if len(parts) < 2 or parts[0][0] != 0x06 or _oid(parts[0][1]) != SIGNED_DATA_OID or parts[1][0] != 0xA0:
        raise Pkcs7Error("файл ЭЦП не PKCS#7 SignedData")
    signed = _children(parts[1][1])
    if len(signed) != 1 or signed[0][0] != 0x30:
        raise Pkcs7Error("файл ЭЦП не PKCS#7 SignedData")
    fields = _children(signed[0][1])
    if len(fields) < 4 or fields[0][0] != 0x02 or fields[1][0] != 0x31 or fields[2][0] != 0x30:
        raise Pkcs7Error("файл ЭЦП не PKCS#7 SignedData")
    _require_detached(fields[2][1])
    index = 3
    certificates = b""
    if index < len(fields) and fields[index][0] == 0xA0:
        certificates = fields[index][1]
        index += 1
    if index < len(fields) and fields[index][0] == 0xA1:
        index += 1
    if index >= len(fields) or fields[index][0] != 0x31 or not _children(fields[index][1]):
        raise Pkcs7Error("в подписи нет подписанта")
    certs = [item for item in _children(certificates) if item[0] == 0x30]
    if not certs:
        raise Pkcs7Error("в подписи нет сертификата подписанта")
    subject, issuer = _certificate_names(certs[0][1])
    return DetachedSignature(der=der, subject=subject, issuer=issuer)


def sample_detached_pkcs7(*, detached: bool = True) -> bytes:
    """Минимальный SignedData для проверок приёмки. Это не подпись ГосСУОК."""
    issuer = _name(((2, 5, 4, 3), "РУЦ ГосСУОК"))
    subject = _name(((2, 5, 4, 3), "Иванов И.И."), ((1, 2, 112, 1, 2, 1, 1, 1, 1, 2), "100000000"))
    sha256 = (2, 16, 840, 1, 101, 3, 4, 2, 1)
    rsa = (1, 2, 840, 113549, 1, 1, 11)
    algorithm = _seq(_oid_tlv(sha256), _tlv(0x05, b""))
    validity = _seq(_tlv(0x17, b"260101000000Z"), _tlv(0x17, b"270101000000Z"))
    spki = _seq(_seq(_oid_tlv((1, 2, 840, 113549, 1, 1, 1)), _tlv(0x05, b"")), _tlv(0x03, b"\x00\x01"))
    tbs = _seq(_int(1), _seq(_oid_tlv(rsa), _tlv(0x05, b"")), issuer, validity, subject, spki)
    certificate = _seq(tbs, _seq(_oid_tlv(rsa), _tlv(0x05, b"")), _tlv(0x03, b"\x00" + b"\x11" * 8))
    encapsulated = [_oid_tlv(DATA_OID)]
    if not detached:
        encapsulated.append(_tlv(0xA0, _tlv(0x04, b"%PDF")))
    signer = _seq(
        _int(1),
        _seq(issuer, _int(1)),
        algorithm,
        _seq(_oid_tlv(rsa), _tlv(0x05, b"")),
        _tlv(0x04, b"\x22" * 16),
    )
    signed = _seq(_int(1), _tlv(0x31, algorithm), _seq(*encapsulated), _tlv(0xA0, certificate), _tlv(0x31, signer))
    return _seq(_oid_tlv(SIGNED_DATA_OID), _tlv(0xA0, signed))


def _unwrap(payload: bytes) -> bytes:
    raw = (payload or b"").strip()
    if STUB_MARK in raw:
        raise Pkcs7Error("локальная отметка не является подписью ГосСУОК")
    if raw.startswith(b"-----"):
        raw = b"".join(line for line in raw.splitlines() if line and not line.startswith(b"-----"))
    if raw[:1] != b"\x30":
        compact = b"".join(raw.split())
        padding = (-len(compact)) % 4
        try:
            raw = base64.b64decode(compact + b"=" * padding, validate=True)
        except (ValueError, TypeError) as exc:
            raise Pkcs7Error("файл ЭЦП не PKCS#7 SignedData") from exc
    if not raw or raw[0] != 0x30 or STUB_MARK in raw:
        raise Pkcs7Error("файл ЭЦП не PKCS#7 SignedData" if STUB_MARK not in raw else "локальная отметка не является подписью ГосСУОК")
    return raw


def _require_detached(body: bytes) -> None:
    parts = _children(body)
    if not parts or parts[0][0] != 0x06:
        raise Pkcs7Error("файл ЭЦП не PKCS#7 SignedData")
    if len(parts) < 2:
        return
    if parts[1][0] != 0xA0:
        raise Pkcs7Error("файл ЭЦП не PKCS#7 SignedData")
    payload = b"".join(item[1] for item in _children(parts[1][1]) if item[0] == 0x04)
    if payload:
        raise Pkcs7Error("нужна отсоединённая подпись: содержимое PDF в файл ЭЦП не вкладывается")


def _certificate_names(body: bytes) -> tuple[str, str]:
    parts = _children(body)
    if not parts or parts[0][0] != 0x30:
        raise Pkcs7Error("в подписи нет сертификата подписанта")
    fields = _children(parts[0][1])
    index = 1 if fields and fields[0][0] == 0xA0 else 0
    if len(fields) < index + 5 or fields[index + 2][0] != 0x30 or fields[index + 4][0] != 0x30:
        raise Pkcs7Error("в подписи нет сертификата подписанта")
    return _format_name(fields[index + 4][1]), _format_name(fields[index + 2][1])


def _format_name(body: bytes) -> str:
    labels = []
    for tag, rdn in _children(body):
        if tag != 0x31:
            continue
        for attr_tag, attr in _children(rdn):
            if attr_tag != 0x30:
                continue
            pair = _children(attr)
            if len(pair) < 2 or pair[0][0] != 0x06:
                continue
            oid = _oid(pair[0][1])
            labels.append(f"{_OID_LABELS.get(oid, '.'.join(map(str, oid)))}={_string(pair[1])}")
    return ", ".join(labels) or "сертификат без имени"


def _string(item: tuple[int, bytes]) -> str:
    tag, body = item
    if tag in {0x0C, 0x13, 0x14, 0x16, 0x12}:
        return body.decode("utf-8", errors="replace")
    if tag == 0x1E:
        return body.decode("utf-16-be", errors="replace")
    return body.hex()


def _children(body: bytes) -> list[tuple[int, bytes]]:
    reader = _Reader(body)
    items = []
    while reader.remaining():
        items.append(reader.take())
    return items


def _oid(body: bytes) -> tuple[int, ...]:
    if not body:
        raise Pkcs7Error("файл ЭЦП не PKCS#7 SignedData")
    parts = [body[0] // 40, body[0] % 40]
    value = 0
    for byte in body[1:]:
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            parts.append(value)
            value = 0
    if value:
        raise Pkcs7Error("файл ЭЦП не PKCS#7 SignedData")
    return tuple(parts)


def _tlv(tag: int, body: bytes) -> bytes:
    return bytes([tag]) + _length(len(body)) + body


def _length(size: int) -> bytes:
    if size < 0x80:
        return bytes([size])
    raw = size.to_bytes((size.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(raw)]) + raw


def _seq(*items: bytes) -> bytes:
    return _tlv(0x30, b"".join(items))


def _int(value: int) -> bytes:
    raw = value.to_bytes((value.bit_length() + 8) // 8, "big")
    if raw[0] & 0x80:
        raw = b"\x00" + raw
    return _tlv(0x02, raw)


def _oid_tlv(parts: tuple[int, ...]) -> bytes:
    body = bytes([40 * parts[0] + parts[1]])
    for part in parts[2:]:
        encoded = [part & 0x7F]
        part >>= 7
        while part:
            encoded.append(0x80 | (part & 0x7F))
            part >>= 7
        body += bytes(reversed(encoded))
    return _tlv(0x06, body)


def _name(*pairs: tuple[tuple[int, ...], str]) -> bytes:
    rdns = []
    for oid, value in pairs:
        rdns.append(_tlv(0x31, _seq(_oid_tlv(oid), _tlv(0x0C, value.encode("utf-8")))))
    return _seq(*rdns)
