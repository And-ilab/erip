#!/bin/sh
set -e

python manage.py migrate --noinput
python manage.py loaddata debt_group_scale bnp_dictionaries message_templates
python manage.py collectstatic --noinput
python manage.py ensure_superuser

# ASGI: асинхронные вызовы шлюза не блокируют воркер
exec gunicorn config.asgi:application -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000 -w 4
