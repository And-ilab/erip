"""Ширина столбцов грида хранится у учётной записи и не видна другому пользователю."""

import re

from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import RegistryPreference

BOARDS = frozenset({
    "accounts",
    "contracts-suppliers",
    "contracts-persons",
    "contracts-services",
    "measures",
    "measures-matrix",
    "measures-ready",
    "claims",
    "card-services",
    "card-payments",
})
_KEY = re.compile(r"^[A-Za-z0-9_]{1,80}$")
_MIN = 36
_MAX = 1600


def clean_widths(payload) -> dict[str, int]:
    if not isinstance(payload, dict):
        raise ValidationError({"widths": "Ожидается набор ширин столбцов"})
    cleaned: dict[str, int] = {}
    for key, value in payload.items():
        if not isinstance(key, str) or not _KEY.match(key):
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        cleaned[key] = max(_MIN, min(_MAX, int(value)))
        if len(cleaned) >= 80:
            break
    return cleaned


class BoardWidthView(APIView):
    """Своя ширина доски. Наблюдатель тоже сохраняет: это его экран, не данные реестра."""

    permission_classes = [IsAuthenticated]

    def get(self, request, board: str):
        self._known(board)
        pref = RegistryPreference.objects.filter(user=request.user, target=board).only("widths").first()
        stored = pref.widths if pref and isinstance(pref.widths, dict) else {}
        return Response({"board": board, "widths": clean_widths(stored)})

    def put(self, request, board: str):
        self._known(board)
        widths = clean_widths(request.data.get("widths"))
        pref, created = RegistryPreference.objects.get_or_create(
            user=request.user, target=board, defaults={"columns": [], "widths": widths},
        )
        if not created:
            pref.widths = widths
            pref.save(update_fields=["widths", "updated_at"])
        return Response({"board": board, "widths": widths})

    def _known(self, board: str) -> None:
        if board not in BOARDS:
            raise ValidationError({"board": "Неизвестная доска"})
