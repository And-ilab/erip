"""Клиент Asterisk Manager Interface: Login, Originate, события до завершения звонка.

Диалплан станции читает переменные ERIP_TEXT, ERIP_AUDIO, ERIP_RECORD, ERIP_TRANSFER.
Имя контекста и шаблон канала задаёт заказчик: в ТЗ их нет.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from dataclasses import dataclass

from .ami_frames import ami_text, encode_frame, parse_frame
from .ami_status import (
    ANSWERED,
    classify_cause,
    classify_originate,
    pick_int,
    pick_listen,
    pick_recording,
)


class AmiError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class AmiReport:
    status: str
    error: str
    duration_sec: int | None
    listen_percent: int | None
    provider_message_id: str
    recording_ref: str


class AmiClient:
    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        secret: str,
        *,
        connect_timeout: float = 5.0,
    ):
        self.host = host
        self.port = port
        self.username = username
        self.secret = secret
        self.connect_timeout = connect_timeout
        self.reader: asyncio.StreamReader | None = None
        self.writer: asyncio.StreamWriter | None = None
        self.logged_in = False

    async def connect(self) -> None:
        try:
            self.reader, self.writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port),
                self.connect_timeout,
            )
        except (TimeoutError, OSError) as exc:
            raise AmiError(f"Нет соединения с AMI {self.host}:{self.port}") from exc
        try:
            banner = await asyncio.wait_for(self.reader.readline(), self.connect_timeout)
        except (TimeoutError, OSError) as exc:
            await self.close()
            raise AmiError("AMI не прислал приветствие") from exc
        if not banner.startswith(b"Asterisk"):
            await self.close()
            raise AmiError("Это не Asterisk AMI")

    async def login(self) -> None:
        await self.send([
            ("Action", "Login"),
            ("Username", self.username),
            ("Secret", self.secret),
            ("Events", "on"),
        ])
        try:
            reply = await self.read_message(self.connect_timeout)
        except AmiError:
            await self.close()
            raise
        if reply.get("Response") != "Success":
            await self.close()
            raise AmiError(_safe(reply.get("Message") or "AMI не принял вход", self.secret))
        self.logged_in = True

    async def ping(self) -> None:
        await self.connect()
        try:
            await self.login()
        finally:
            await self.close()

    async def originate(
        self,
        *,
        channel: str,
        context: str,
        exten: str,
        priority: int,
        caller_id: str,
        text: str,
        audio: str,
        record: bool,
        transfer: bool,
        timeout_ms: int,
        wait_sec: float,
    ) -> AmiReport:
        action_id = uuid.uuid4().hex[:16]
        fields = [
            ("Action", "Originate"),
            ("ActionID", action_id),
            ("Channel", channel),
            ("Context", context),
            ("Exten", exten),
            ("Priority", str(priority)),
            ("Timeout", str(timeout_ms)),
            ("Async", "true"),
            ("Variable", f"ERIP_TEXT={ami_text(text)}"),
            ("Variable", f"ERIP_AUDIO={ami_text(audio)}"),
            ("Variable", f"ERIP_RECORD={'1' if record else '0'}"),
            ("Variable", f"ERIP_TRANSFER={'1' if transfer else '0'}"),
            ("Variable", f"ERIP_ACTION={action_id}"),
        ]
        if caller_id:
            fields.append(("CallerID", ami_text(caller_id)))
        await self.send(fields)
        return await self._wait_outcome(action_id, wait_sec)

    async def send(self, fields: list[tuple[str, str]]) -> None:
        if self.writer is None:
            raise AmiError("Нет соединения с AMI")
        self.writer.write(encode_frame(fields))
        try:
            await self.writer.drain()
        except OSError as exc:
            raise AmiError("AMI закрыл соединение") from exc

    async def read_message(self, timeout: float) -> dict[str, str]:
        if self.reader is None:
            raise AmiError("Нет соединения с AMI")
        if timeout <= 0:
            raise AmiError("AMI не прислал исход звонка")
        lines: list[str] = []
        while True:
            try:
                line = await asyncio.wait_for(self.reader.readline(), timeout)
            except TimeoutError as exc:
                raise AmiError("AMI не прислал исход звонка") from exc
            except OSError as exc:
                raise AmiError("AMI закрыл соединение") from exc
            if line == b"":
                raise AmiError("AMI закрыл соединение")
            text = line.decode("utf-8", "replace").rstrip("\r\n")
            if text == "":
                if lines:
                    return parse_frame("\n".join(lines))
                continue
            lines.append(text)

    async def close(self) -> None:
        writer = self.writer
        if writer is None:
            return
        try:
            if self.logged_in:
                self.logged_in = False
                writer.write(encode_frame([("Action", "Logoff")]))
                await writer.drain()
        except OSError:
            pass
        writer.close()
        try:
            await writer.wait_closed()
        except OSError:
            pass
        self.reader = None
        self.writer = None

    async def _wait_outcome(self, action_id: str, wait_sec: float) -> AmiReport:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + wait_sec
        status = ""
        error = ""
        uniqueid = ""
        duration: int | None = None
        listen: int | None = None
        recording = ""
        while True:
            remaining = deadline - loop.time()
            try:
                message = await self.read_message(remaining)
            except AmiError:
                if status:
                    break
                raise
            event = message.get("Event", "")
            if not event and message.get("ActionID") == action_id and message.get("Response") == "Error":
                raise AmiError(_safe(message.get("Message") or "AMI отклонил Originate", self.secret))
            if not event:
                continue
            if event == "OriginateResponse" and message.get("ActionID") == action_id:
                uniqueid = message.get("Uniqueid") or uniqueid
                classified = classify_originate(message.get("Reason", ""), message.get("DialStatus", ""))
                if classified is None:
                    continue
                status, error = classified
                if status != ANSWERED:
                    break
                continue
            if not _same_call(message, action_id, uniqueid):
                continue
            found_duration = pick_int(message, ("Billsec", "Duration", "ERIP_DURATION"))
            if found_duration is not None:
                duration = found_duration
            found_listen = pick_listen(message)
            if found_listen is not None:
                listen = found_listen
            found_recording = pick_recording(message)
            if found_recording:
                recording = found_recording
            if event == "Hangup":
                if not status:
                    status, error = classify_cause(message.get("Cause", ""))
                break
        if not status:
            raise AmiError("AMI не прислал исход звонка")
        if status != ANSWERED:
            duration = 0
            listen = None
            recording = ""
        return AmiReport(
            status=status,
            error=error,
            duration_sec=duration,
            listen_percent=listen,
            provider_message_id=_provider_id(uniqueid, action_id),
            recording_ref=recording,
        )


def channel_for(template: str, phone: str) -> str:
    if "{phone}" not in template and "{digits}" not in template:
        raise AmiError("GW_AMI_CHANNEL должен содержать {phone} или {digits}")
    digits = re.sub(r"\D", "", phone)
    return template.replace("{phone}", phone).replace("{digits}", digits)


def belarus_dial_number(phone: str) -> str:
    """Номер, который можно отдать на станцию. Пусто — не +375."""
    raw = re.sub(r"[\s\-()]", "", (phone or "").strip())
    if raw.startswith("+") and not raw.startswith("+375"):
        return ""
    digits = re.sub(r"\D", "", raw)
    if not digits.startswith("375"):
        return ""
    return f"+{digits}"


def _same_call(message: dict, action_id: str, uniqueid: str) -> bool:
    if message.get("ActionID") == action_id:
        return True
    if uniqueid and message.get("Uniqueid") == uniqueid:
        return True
    if uniqueid and message.get("Linkedid") == uniqueid:
        return True
    return False


def _provider_id(uniqueid: str, action_id: str) -> str:
    raw = re.sub(r"[^A-Za-z0-9._-]", "", uniqueid or action_id)[:48]
    return f"ami-{raw}"[:64]


def _safe(message: str, secret: str) -> str:
    if secret and secret in message:
        return "AMI не принял вход"
    return message[:200] or "AMI не принял вход"
