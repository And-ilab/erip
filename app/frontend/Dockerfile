# Angular собирается в образе. Контекст — каталог app/.
FROM node:20-bookworm-slim AS build

WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/angular.json frontend/tsconfig.json frontend/tsconfig.app.json ./
COPY frontend/src ./src
RUN npm run build

# Подложка не лежит в git. Сборка сама забирает срез Беларуси, чтобы пустая папка на сервере не закрывала карту.
FROM nginx:1.27-alpine AS tiles
ARG TARGETARCH
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) arch=x86_64 ;; \
      arm64) arch=arm64 ;; \
      *) echo "unsupported arch $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    apk add --no-cache ca-certificates curl tar; \
    curl -fsSL -o /tmp/pmtiles.tar.gz "https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_${arch}.tar.gz"; \
    tar -xzf /tmp/pmtiles.tar.gz -C /usr/local/bin pmtiles; \
    mkdir -p /maps; \
    pmtiles extract "https://build.protomaps.com/20261005.pmtiles" /maps/belarus.pmtiles \
      --bbox=23.17,51.26,32.78,56.18 --maxzoom=14 --download-threads=8; \
    test "$(stat -c%s /maps/belarus.pmtiles)" -gt 100000000

FROM nginx:1.27-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/erip/browser /usr/share/nginx/html
COPY --from=tiles /maps/belarus.pmtiles /usr/share/nginx/html/maps/belarus.pmtiles
