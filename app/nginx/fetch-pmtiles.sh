#!/bin/sh
# Срез карты лежит в томе и переживает очистку кэша сборки.
# Повторный запуск только проверяет размер файла и сразу выходит.
set -eu

dest="${PMTILES_DEST:-/maps/belarus.pmtiles}"
min=100000000

mkdir -p "$(dirname "$dest")"

if [ -f "$dest" ]; then
  size=$(stat -c%s "$dest")
  if [ "$size" -gt "$min" ]; then
    echo "pmtiles: уже в томе, ${size} байт, загрузка пропущена"
    exit 0
  fi
  rm -f "$dest"
fi

now=$(date +%s)
found=""
i=0
while [ "$i" -le 13 ]; do
  day=$(date -u -d "@$((now - i * 86400))" +%Y%m%d)
  url="https://build.protomaps.com/${day}.pmtiles"
  if curl -fsI -o /dev/null --connect-timeout 5 --max-time 12 --retry 1 --retry-delay 1 "$url"; then
    found="$url"
    break
  fi
  i=$((i + 1))
done

echo "pmtiles source: ${found}"
test -n "$found"

tmp="${dest}.partial"
rm -f "$tmp"
/usr/local/bin/pmtiles extract "$found" "$tmp" \
  --bbox=23.17,51.26,32.78,56.18 --maxzoom=14 --download-threads=8
test "$(stat -c%s "$tmp")" -gt "$min"
mv "$tmp" "$dest"
chmod 644 "$dest"
echo "pmtiles: записан ${dest}"
