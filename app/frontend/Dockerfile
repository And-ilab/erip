# Образ только раздаёт уже собранный Angular.
# Сборка фронта на хосте: из app/frontend выполнить npm run build.
# Сборка образа из каталога app/: docker build -f frontend/Dockerfile .
FROM nginx:1.27-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY frontend/dist/erip/browser /usr/share/nginx/html
