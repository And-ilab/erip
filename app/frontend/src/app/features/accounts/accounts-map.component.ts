import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, inject, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { Map as MlMap, Marker, StyleSpecification } from 'maplibre-gl';

import { ApiService, errorMessage } from '../../core/api.service';
import { MapBubble, MapLevel } from '../../core/models';

let pmtilesReady = false;

function belarusStyle(tileUrl: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      belarus: {
        type: 'vector',
        url: `pmtiles://${tileUrl}`,
        attribution: '© OpenStreetMap',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#c5dff0' } },
      { id: 'earth', type: 'fill', source: 'belarus', 'source-layer': 'earth', paint: { 'fill-color': '#f4f0e6' } },
      { id: 'landcover', type: 'fill', source: 'belarus', 'source-layer': 'landcover', paint: { 'fill-color': '#e4efd4', 'fill-opacity': 0.7 } },
      {
        id: 'landuse-green', type: 'fill', source: 'belarus', 'source-layer': 'landuse', minzoom: 10,
        filter: ['in', 'kind', 'park', 'forest', 'wood', 'grass', 'meadow', 'garden', 'national_park', 'nature_reserve'],
        paint: { 'fill-color': '#d5e8c0' },
      },
      {
        id: 'landuse-residential', type: 'fill', source: 'belarus', 'source-layer': 'landuse', minzoom: 12,
        filter: ['==', 'kind', 'residential'],
        paint: { 'fill-color': '#efe8dc' },
      },
      { id: 'water', type: 'fill', source: 'belarus', 'source-layer': 'water', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#b7d4e8' } },
      { id: 'water-line', type: 'line', source: 'belarus', 'source-layer': 'water', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#9ec4dc', 'line-width': 1 } },
      {
        id: 'roads-minor', type: 'line', source: 'belarus', 'source-layer': 'roads', minzoom: 13,
        filter: ['==', 'kind', 'minor_road'],
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 15, 2.2] },
      },
      {
        id: 'roads-major', type: 'line', source: 'belarus', 'source-layer': 'roads',
        filter: ['in', 'kind', 'highway', 'major_road'],
        paint: { 'line-color': '#f0d48a', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 14, 3.2] },
      },
      {
        id: 'buildings', type: 'fill', source: 'belarus', 'source-layer': 'buildings', minzoom: 14,
        paint: { 'fill-color': '#e4d9c8', 'fill-opacity': 0.85 },
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
        style: belarusStyle(`${window.location.origin}/maps/belarus.pmtiles`),
        center: [27.95, 53.7],
        zoom: 6,
        maxZoom: 16,
        fadeDuration: 0,
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
      map.on('error', () => {
        if (!this.mapLoaded) this.mapFailed.set('Файл карты на сервере не открылся. Пузыри сверху всё равно открывают дерево.');
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
