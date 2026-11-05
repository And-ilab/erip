#!/bin/sh
set -e

python manage.py migrate --noinput
python manage.py loaddata debt_group_scale bnp_dictionaries notary_offices message_templates
python manage.py collectstatic --noinput
python manage.py ensure_superuser
python manage.py seed_role_testers

if [ "$1" = "pris-poll" ]; then
  exec python manage.py pris_poll
fi

exec gunicorn config.asgi:application -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000 -w 2
