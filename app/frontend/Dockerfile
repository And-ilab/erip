# Образ только раздаёт уже собранный Angular.
# На Windows npm ci внутри Docker обрывает демон (error reading from server: EOF),
# поэтому сборка фронта выполняется на хосте: из app/frontend — npm run build.
# Сборка образа из каталога app/: docker compose build nginx
FROM nginx:1.27-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY frontend/dist/erip/browser /usr/share/nginx/html
