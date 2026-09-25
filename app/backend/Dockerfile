FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/backend

RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "from django.core.management import execute_from_command_line"

COPY . .
# Windows-сборка иногда приносит CRLF: ядро Linux тогда не запускает shebang (exec format error).
RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh && mkdir -p media

EXPOSE 8000
ENTRYPOINT ["/bin/sh", "/srv/backend/entrypoint.sh"]
