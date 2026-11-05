# Образ только для одноразовой загрузки среза карты. Angular сюда не входит.
FROM nginx:1.27-alpine
ARG TARGETARCH
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) arch=x86_64 ;; \
      arm64) arch=arm64 ;; \
      *) echo "unsupported arch $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    apk add --no-cache ca-certificates curl tar; \
    curl -fsSL --connect-timeout 10 --max-time 60 \
      -o /tmp/pmtiles.tar.gz \
      "https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_${arch}.tar.gz"; \
    tar -xzf /tmp/pmtiles.tar.gz -C /usr/local/bin pmtiles; \
    rm -f /tmp/pmtiles.tar.gz
COPY fetch-pmtiles.sh /usr/local/bin/fetch-pmtiles.sh
RUN sed -i 's/\r$//' /usr/local/bin/fetch-pmtiles.sh && chmod +x /usr/local/bin/fetch-pmtiles.sh
VOLUME /maps
ENTRYPOINT ["/usr/local/bin/fetch-pmtiles.sh"]
