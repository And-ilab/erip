import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, inject, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { Map as MlMap, Marker, StyleSpecification } from 'maplibre-gl';

import { ApiService, errorMessage } from '../../core/api.service';
import { MapBubble, MapLevel } from '../../core/models';

let pmtilesReady = false;

function belarusStyle(tileUrl: string, glyphs: string): StyleSpecification {
  const streetName = ['coalesce', ['get', 'name'], ['get', 'pgf:name']];
  return {
    version: 8,
    glyphs,
    sources: {
      belarus: {
        type: 'vector',
        url: `pmtiles://${tileUrl}`,
        attribution: '© OpenStreetMap',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#f8f4f0' } },
      { id: 'earth', type: 'fill', source: 'belarus', 'source-layer': 'earth', paint: { 'fill-color': '#f8f4f0' } },
      {
        id: 'farmland', type: 'fill', source: 'belarus', 'source-layer': 'landcover', maxzoom: 8,
        filter: ['==', 'kind', 'farmland'],
        paint: { 'fill-color': 'hsla(80, 45%, 84%, 0.55)' },
      },
      {
        id: 'wood', type: 'fill', source: 'belarus', 'source-layer': 'landcover',
        filter: ['in', 'kind', 'forest', 'wood'],
        paint: { 'fill-color': 'hsla(98, 61%, 72%, 0.7)', 'fill-opacity': 0.7 },
      },
      {
        id: 'wood-landuse', type: 'fill', source: 'belarus', 'source-layer': 'landuse',
        filter: ['in', 'kind', 'forest', 'wood'],
        paint: { 'fill-color': 'hsla(98, 61%, 72%, 0.7)', 'fill-opacity': 0.55 },
      },
      {
        id: 'grass', type: 'fill', source: 'belarus', 'source-layer': 'landcover',
        filter: ['in', 'kind', 'grassland', 'grass', 'scrub'],
        paint: { 'fill-color': 'rgba(176, 213, 154, 1)', 'fill-opacity': 0.45 },
      },
      {
        id: 'park', type: 'fill', source: 'belarus', 'source-layer': 'landuse', minzoom: 8,
        filter: ['in', 'kind', 'park', 'garden', 'grass', 'meadow', 'national_park', 'nature_reserve'],
        paint: { 'fill-color': '#d8e8c8', 'fill-opacity': 0.85 },
      },
      {
        id: 'residential', type: 'fill', source: 'belarus', 'source-layer': 'landuse', minzoom: 9,
        filter: ['==', 'kind', 'residential'],
        paint: {
          'fill-color': ['interpolate', ['linear'], ['zoom'], 9, 'hsla(0, 3%, 85%, 0.84)', 12, 'hsla(35, 57%, 88%, 0.49)'],
        },
      },
      { id: 'water', type: 'fill', source: 'belarus', 'source-layer': 'water', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': 'rgb(158, 189, 255)' } },
      { id: 'water-line', type: 'line', source: 'belarus', 'source-layer': 'water', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#a0c8f0', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2.4] } },
      {
        id: 'boundary', type: 'line', source: 'belarus', 'source-layer': 'boundaries',
        filter: ['==', 'kind', 'country'],
        paint: { 'line-color': 'hsl(248, 1%, 41%)', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 12, 2.4] },
      },
      {
        id: 'road-minor-casing', type: 'line', source: 'belarus', 'source-layer': 'roads', minzoom: 10,
        filter: ['==', 'kind', 'minor_road'],
        paint: { 'line-color': '#cfcdca', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 12, 2.2, 14, 5, 17, 14] },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'road-major-casing', type: 'line', source: 'belarus', 'source-layer': 'roads',
        filter: ['==', 'kind', 'major_road'],
        paint: { 'line-color': '#e9ac77', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.4, 10, 3.2, 14, 8, 17, 16] },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'road-highway-casing', type: 'line', source: 'belarus', 'source-layer': 'roads', minzoom: 5,
        filter: ['==', 'kind', 'highway'],
        paint: { 'line-color': '#e9ac77', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.4, 8, 2.8, 14, 9, 17, 18] },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'road-minor', type: 'line', source: 'belarus', 'source-layer': 'roads', minzoom: 10,
        filter: ['==', 'kind', 'minor_road'],
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 12, 1.4, 14, 3.2, 17, 11] },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'road-major', type: 'line', source: 'belarus', 'source-layer': 'roads',
        filter: ['==', 'kind', 'major_road'],
        paint: { 'line-color': '#fea', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.9, 10, 2.2, 14, 5.5, 17, 12] },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'road-highway', type: 'line', source: 'belarus', 'source-layer': 'roads', minzoom: 5,
        filter: ['==', 'kind', 'highway'],
        paint: { 'line-color': '#fc8', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 8, 1.8, 14, 6, 17, 14] },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'buildings', type: 'fill', source: 'belarus', 'source-layer': 'buildings', minzoom: 13,
        filter: ['in', 'kind', 'building', 'building_part'],
        paint: {
          'fill-color': 'hsl(35, 8%, 85%)',
          'fill-outline-color': ['interpolate', ['linear'], ['zoom'], 13, 'hsla(35, 6%, 79%, 0.32)', 14, 'hsl(35, 6%, 79%)'],
        },
      },
      {
        id: 'place-neighbourhood', type: 'symbol', source: 'belarus', 'source-layer': 'places', minzoom: 12,
        filter: ['in', 'kind', 'neighbourhood', 'macrohood'],
        layout: { 'text-field': streetName, 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
        paint: { 'text-color': '#666', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
      },
      {
        id: 'place-locality', type: 'symbol', source: 'belarus', 'source-layer': 'places', minzoom: 5,
        filter: ['==', 'kind', 'locality'],
        layout: { 'text-field': streetName, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 11, 16] },
        paint: { 'text-color': '#000', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
      },
      {
        id: 'place-region', type: 'symbol', source: 'belarus', 'source-layer': 'places', minzoom: 5, maxzoom: 9,
        filter: ['==', 'kind', 'region'],
        layout: { 'text-field': streetName, 'text-font': ['Noto Sans Regular'], 'text-size': 13 },
        paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
      },
      {
        id: 'road-label-major', type: 'symbol', source: 'belarus', 'source-layer': 'roads', minzoom: 12,
        filter: ['all', ['in', 'kind', 'highway', 'major_road'], ['any', ['has', 'name'], ['has', 'pgf:name']]],
        layout: { 'symbol-placement': 'line', 'text-field': streetName, 'text-font': ['Noto Sans Regular'], 'text-size': 13 },
        paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1.4 },
      },
      {
        id: 'road-label-minor', type: 'symbol', source: 'belarus', 'source-layer': 'roads', minzoom: 13,
        filter: ['all', ['==', 'kind', 'minor_road'], ['any', ['has', 'name'], ['has', 'pgf:name']]],
        layout: { 'symbol-placement': 'line', 'text-field': streetName, 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
        paint: { 'text-color': '#555', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
      },
    ],
  } as StyleSpecification;
}

const GROUP_COLOR: Record<number, string> = {
  1: '#22c55e',
  2: '#84cc16',
  3: '#eab308',
  4: '#f97316',
  5: '#ef4444',
  6: '#7f1d1d',
};

@Component({
  selector: 'app-accounts-map',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    <div class="map-bar">
      @if ((level()?.breadcrumb?.length ?? 0) > 1) {
        <button mat-stroked-button type="button" (click)="back()">Назад</button>
      }
      <span class="crumbs">
        @for (item of level()?.breadcrumb ?? []; track item.id; let last = $last) {
          @if (!last) {
            <button type="button" class="link" (click)="goto(item.id)">{{ item.name }}</button>
            <span> / </span>
          } @else {
            <strong>{{ item.name }}</strong>
          }
        }
      </span>
      @if (level()?.unplaced) {
        <span class="muted">Без адреса: {{ level()?.unplaced }}. Они остаются в списке.</span>
      }
    </div>
    <p class="muted">Число в пузыре — лицевые счета, цвет — группа, которой в этом месте больше. Подложка — файл карты на этом сервере.</p>
    @if (error()) { <p class="status-failed">{{ error() }}</p> }
    @if (mapFailed()) { <p class="status-failed">{{ mapFailed() }}</p> }
    <ul class="tree">
      @for (child of level()?.children ?? []; track child.id) {
        <li>
          <button type="button" (click)="open(child)">
            <i [style.background]="color(child.dominant_group)"></i>
            {{ child.name }}
            <b>{{ child.accounts }}</b>
          </button>
        </li>
      }
    </ul>
    <div #canvas class="map-canvas"></div>
    @if (level() && !level()!.children.length && !error()) {
      <p>На этом уровне по текущему фильтру лицевых счетов нет.</p>
      @if (level()?.parent) {
        <button mat-stroked-button type="button" (click)="openList.emit(level()!.parent!)">Открыть список</button>
      }
    }
  `,
  styles: [`
    .map-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
    .crumbs { color: var(--erip-primary-dark); }
    .link { border: 0; background: none; color: var(--erip-link); cursor: pointer; padding: 0; }
    .muted { color: var(--erip-muted); font-size: 13px; }
    .map-canvas { height: 560px; border: 1px solid var(--erip-border); border-radius: 8px; }
    .tree { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 0 0; margin: 0; }
    .tree button { display: flex; align-items: center; gap: 8px; border: 1px solid var(--erip-border); background: #fff; border-radius: 999px; padding: 6px 12px; cursor: pointer; }
    .tree i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  `],
})
export class AccountsMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  private readonly api = inject(ApiService);

  @ViewChild('canvas') canvas?: ElementRef<HTMLDivElement>;
  @Input() query: Record<string, string | number | null> = {};
  readonly openList = output<{ id: number; name: string }>();

  protected readonly level = signal<MapLevel | null>(null);
  protected readonly error = signal('');
  protected readonly mapFailed = signal('');
  private parentId: number | null = null;
  private map: MlMap | null = null;
  private markers: Marker[] = [];
  private maplibregl: typeof import('maplibre-gl') | null = null;
  private request = 0;
  private mapLoaded = false;

  ngAfterViewInit(): void {
    void this.ensure();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['query'] && !changes['query'].firstChange && this.map) this.load();
  }

  ngOnDestroy(): void {
    this.clearMarkers();
    this.map?.remove();
    this.map = null;
  }

  async ensure(): Promise<void> {
    if (this.map || !this.canvas) return;
    try {
      const loaded = await import('maplibre-gl') as typeof import('maplibre-gl') & {
        default?: typeof import('maplibre-gl');
      };
      const maplibregl = loaded.default?.Map ? loaded.default : loaded;
      this.maplibregl = maplibregl;
      if (!pmtilesReady) {
        const { Protocol } = await import('pmtiles');
        const protocol = new Protocol();
        maplibregl.addProtocol('pmtiles', protocol.tile);
        pmtilesReady = true;
      }
      const map = new maplibregl.Map({
        container: this.canvas.nativeElement,
        style: belarusStyle(
          `${window.location.origin}/maps/belarus.pmtiles`,
          `${window.location.origin}/fonts/{fontstack}/{range}.pbf`,
        ),
        center: [27.95, 53.7],
        zoom: 6,
        maxZoom: 17,
        maxPitch: 0,
        fadeDuration: 0,
        transformRequest: (url, kind) => kind === 'Glyphs' ? { url: encodeURI(url) } : { url },
      });
      this.map = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => {
        this.mapLoaded = true;
        map.resize();
        this.mapFailed.set('');
        const level = this.level();
        if (level) this.draw(level);
      });
      map.on('error', (event) => {
        if (this.mapLoaded) return;
        const detail = event.error as { message?: string; url?: string };
        const where = `${detail?.url ?? ''} ${detail?.message ?? ''}`;
        if (where.includes('/maps/') || where.includes('pmtiles')) {
          this.mapFailed.set('Файл карты на сервере не открылся. Пузыри сверху всё равно открывают дерево.');
        }
      });
    } catch {
      this.mapFailed.set('Карта не открылась. Пузыри сверху всё равно открывают дерево.');
    }
    this.load();
  }

  back(): void {
    const crumbs = this.level()?.breadcrumb ?? [];
    if (crumbs.length < 2) return;
    this.goto(crumbs[crumbs.length - 2].id);
  }

  goto(id: number): void {
    const root = this.level()?.breadcrumb?.[0];
    this.parentId = root && root.id === id ? null : id;
    this.load();
  }

  open(child: MapBubble): void {
    if (child.kind === 'house') {
      const trail = [...(this.level()?.breadcrumb ?? []).map((item) => item.name), child.name];
      this.openList.emit({ id: child.id, name: trail.join(' / ') });
      return;
    }
    this.parentId = child.id;
    this.load();
  }

  color(group: number | null): string {
    return GROUP_COLOR[group ?? 0] ?? '#1d4f63';
  }

  private load(): void {
    const current = ++this.request;
    const params = { ...this.query };
    if (this.parentId) params['parent'] = this.parentId;
    this.api.accountMap(params).subscribe({
      next: (level) => {
        if (current !== this.request) return;
        this.level.set(level);
        this.error.set('');
        if (this.mapLoaded) this.draw(level);
      },
      error: (e) => {
        if (current !== this.request) return;
        this.error.set(errorMessage(e));
      },
    });
  }

  private draw(level: MapLevel): void {
    const map = this.map;
    const maplibregl = this.maplibregl;
    if (!map || !maplibregl) return;
    this.clearMarkers();
    const placed = level.children.filter((child) => child.longitude != null && child.latitude != null);
    for (const child of placed) {
      const size = Math.min(72, 36 + Math.sqrt(child.accounts) * 6);
      const wrap = document.createElement('div');
      wrap.style.position = 'absolute';
      wrap.style.top = '0';
      wrap.style.left = '0';
      wrap.style.width = `${size}px`;
      wrap.style.height = `${size}px`;
      const button = document.createElement('button');
      button.type = 'button';
      button.style.width = '100%';
      button.style.height = '100%';
      button.style.margin = '0';
      button.style.padding = '0';
      button.style.boxSizing = 'border-box';
      button.style.background = this.color(child.dominant_group);
      button.style.border = '2px solid #fff';
      button.style.borderRadius = '999px';
      button.style.color = '#fff';
      button.style.font = '700 15px Roboto, Segoe UI, sans-serif';
      button.style.boxShadow = '0 2px 8px rgba(0,0,0,.25)';
      button.style.cursor = 'pointer';
      button.textContent = String(child.accounts);
      const label = document.createElement('span');
      label.textContent = child.name;
      label.style.position = 'absolute';
      label.style.top = '100%';
      label.style.left = '50%';
      label.style.transform = 'translateX(-50%)';
      label.style.marginTop = '2px';
      label.style.whiteSpace = 'nowrap';
      label.style.font = '600 11px Roboto, Segoe UI, sans-serif';
      label.style.color = '#1f2933';
      label.style.textShadow = '0 0 3px #fff, 0 0 3px #fff';
      label.style.pointerEvents = 'none';
      wrap.append(button, label);
      wrap.title = this.hint(child);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.open(child);
      });
      const marker = new maplibregl.Marker({ element: wrap, anchor: 'center' })
        .setLngLat([child.longitude as number, child.latitude as number])
        .addTo(map);
      this.markers.push(marker);
    }
    if (placed.length === 1) {
      map.jumpTo({
        center: [placed[0].longitude as number, placed[0].latitude as number],
        zoom: this.zoom(placed[0].kind),
      });
      return;
    }
    if (placed.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      for (const child of placed) bounds.extend([child.longitude as number, child.latitude as number]);
      map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 0 });
    }
  }

  private zoom(kind: string): number {
    if (kind === 'oblast') return 7;
    if (kind === 'settlement') return 11;
    if (kind === 'district' || kind === 'microdistrict') return 12;
    if (kind === 'street') return 14;
    return 16;
  }

  private hint(child: MapBubble): string {
    const groups = Object.entries(child.groups)
      .filter(([, count]) => count > 0)
      .map(([group, count]) => `${group}: ${count}`)
      .join(', ');
    return groups ? `${child.name}. Группы ${groups}` : child.name;
  }

  private clearMarkers(): void {
    for (const marker of this.markers) marker.remove();
    this.markers = [];
  }
}
