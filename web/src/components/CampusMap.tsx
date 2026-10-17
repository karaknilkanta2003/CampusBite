import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useSession } from '../session';
import type { Canteen } from '../types';
import { crowdClass } from './ui';

export interface LatLon {
  lat: number;
  lon: number;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function markerIcon(c: Canteen, selected: boolean): L.DivIcon {
  const cls = c.kind === 'mess' ? 'mess' : crowdClass(c);
  const label = c.name.replace(/\s*\(.*\)$/, '');
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="cb-marker ${c.kind === 'mess' ? 'mess' : ''} ${selected ? 'selected' : ''}" role="img" aria-label="${escapeHtml(`${c.name}: ${c.status.label}`)}">
      <span class="bubble"><span class="dot bg-${cls}"></span>${escapeHtml(label)}</span><span class="stem"></span></div>`,
  });
}

/**
 * Interactive campus map (OpenStreetMap tiles via Leaflet). Canteen markers are
 * coloured by crowd level; messes are grey. Click a marker to select it.
 */
export function CampusMap({
  canteens,
  selectedId,
  onSelect,
  me,
  tall,
  focus,
}: {
  canteens: Canteen[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  me?: LatLon | null;
  tall?: boolean;
  /** Zoom in on one place instead of fitting the whole campus. */
  focus?: LatLon | null;
}) {
  const { config } = useSession();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Create the map once.
  useEffect(() => {
    if (!el.current || map.current || !config) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, tap: true } as L.MapOptions);
    L.tileLayer(config.map.tileUrl, { attribution: config.map.attribution, maxZoom: 19 }).addTo(m);
    m.setView(config.map.center, config.map.zoom);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // The container can change size after first paint (fonts, layout); keep tiles aligned.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      fitted.current = false;
    };
  }, [config]);

  // Redraw markers whenever the data changes.
  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    const placed = canteens.filter((c) => c.lat !== null && c.lon !== null);
    for (const c of placed) {
      const marker = L.marker([c.lat!, c.lon!], {
        icon: markerIcon(c, c.id === selectedId),
        title: c.name,
        keyboard: true,
        zIndexOffset: c.kind === 'mess' ? 0 : 500,
      });
      marker.on('click', () => onSelectRef.current?.(c.id));
      marker.addTo(group);
    }
    if (me) {
      L.marker([me.lat, me.lon], {
        icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<div class="cb-me" role="img" aria-label="You are here"></div>' }),
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(group);
    }
    if (focus) {
      m.setView([focus.lat, focus.lon], 18);
    } else if (!fitted.current && placed.length > 1) {
      m.fitBounds(L.latLngBounds(placed.map((c) => [c.lat!, c.lon!] as [number, number])).pad(0.15), { maxZoom: 18 });
      fitted.current = true;
    }
  }, [canteens, selectedId, me, focus]);

  // Show the student and campus together when their location arrives.
  useEffect(() => {
    const m = map.current;
    if (!m || !me) return;
    const points = canteens.filter((c) => c.lat !== null).map((c) => [c.lat!, c.lon!] as [number, number]);
    const bounds = L.latLngBounds([...points, [me.lat, me.lon]]);
    if (bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 3000) m.fitBounds(bounds.pad(0.15), { maxZoom: 18 });
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className={`map-box${tall ? ' tall' : ''}`} aria-label="Campus map" />;
}

/** Straight-line distance in metres. */
export function distanceMetres(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "4 min walk" (paths add about a third to the straight line; walking ≈ 75 m a minute). */
export function walkLabel(from: LatLon, c: Canteen): string | null {
  if (c.lat === null || c.lon === null) return null;
  const m = distanceMetres(from, { lat: c.lat, lon: c.lon }) * 1.3;
  if (m > 3000) return `${(m / 1000).toFixed(1)} km away`;
  return `${Math.max(1, Math.round(m / 75))} min walk`;
}
