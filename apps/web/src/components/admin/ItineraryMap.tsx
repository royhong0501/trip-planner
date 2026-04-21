import { useEffect, useRef, useState, forwardRef, useImperativeHandle, memo } from 'react';
import { ActivityCard, HotelInfo } from '@/types/trip';
import { getDayColor } from '@/lib/dayColors';
import { resolveHotelRoles } from '@/lib/hotels';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface MapHandle {
  panToActivity: (activityId: string) => void;
}

/** Travel info for one leg (between two consecutive activities). */
export interface RouteSegment {
  duration: string;
  distance: string;
}

interface Props {
  activities: ActivityCard[];
  /** 當日覆蓋且有座標的飯店（由父元件過濾好）。用來畫 H pin、決定路線起終點。 */
  hotels?: HotelInfo[];
  /** 當日 ISO 日期 (YYYY-MM-DD 即可)。用於 resolveHotelRoles 判斷 origin/destination。 */
  dayDate?: string;
  showMarkers: boolean;
  dayIndex: number;
  activeActivityId?: string | null;
  onMarkerClick?: (activityId: string) => void;
  /**
   * Called after each route calculation.
   *  - segmentsFromEachActivity[i] = 從 activity[i] 出發到下一點（下一個 activity 或 hotel destination）那段；
   *    對齊 activities 陣列的 index；沒有就是 { duration:'', distance:'' }
   *  - originSegment = 飯店 origin → 第一個 activity 那段（無 hotel origin 時為 null）
   *  空 segments 陣列 + null origin = 無路線（fallback 或資料不足）
   */
  onRouteSegments?: (
    segmentsFromEachActivity: RouteSegment[],
    originSegment: RouteSegment | null,
  ) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_SAFE_ZOOM          = 18;
const OFFSET_RADIUS          = 0.00010;
const GOLDEN_ANGLE           = 137.508;
const DIRECTIONS_DEBOUNCE_MS = 500;
const FIT_PADDING            = { top: 72, right: 64, bottom: 72, left: 64 };
const SEGMENT_FIT_PADDING    = { top: 100, right: 100, bottom: 100, left: 100 };

// ─── Map styles: desaturate + strip POI ──────────────────────────────────────

const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: 'all',            elementType: 'all',         stylers: [{ saturation: -75 }] },
  { featureType: 'administrative', elementType: 'geometry',    stylers: [{ lightness: 20 }] },
  { featureType: 'poi',            elementType: 'labels',      stylers: [{ visibility: 'off' }] },
  { featureType: 'poi',            elementType: 'geometry',    stylers: [{ lightness: 10 }] },
  { featureType: 'road',           elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',        elementType: 'labels',      stylers: [{ visibility: 'simplified' }, { saturation: -80 }] },
  { featureType: 'water',          elementType: 'geometry',    stylers: [{ lightness: 15 }] },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolvePositions(valid: ActivityCard[]): Array<{ lat: number; lng: number }> {
  const seen = new Map<string, number>();
  return valid.map((act) => {
    const lat = act.lat as number;
    const lng = act.lng as number;
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    const n   = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) return { lat, lng };
    const angle = (n * GOLDEN_ANGLE * Math.PI) / 180;
    return { lat: lat + OFFSET_RADIUS * Math.cos(angle), lng: lng + OFFSET_RADIUS * Math.sin(angle) };
  });
}

function makeIcon(color: string, isActive: boolean): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: isActive ? 4 : 2,
    scale: isActive ? 12 : 10,
    labelOrigin: new google.maps.Point(0, 0),
  };
}

/** 方形 H pin — 與活動圓點區分；同日色；比活動略大讓 'H' label 清楚。 */
function makeHotelIcon(color: string): google.maps.Symbol {
  return {
    path: 'M -9 -9 L 9 -9 L 9 9 L -9 9 Z',
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
    scale: 1,
    labelOrigin: new google.maps.Point(0, 0),
  };
}

function waypointKey(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  mids: Array<{ lat: number; lng: number }>,
): string {
  const fmt = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  return [fmt(origin), ...mids.map(fmt), fmt(dest)].join('|');
}

/** Concatenate all step paths across a leg → full road-aligned LatLng array. */
function getLegPath(leg: google.maps.DirectionsLeg): google.maps.LatLng[] {
  return leg.steps.flatMap((s) => s.path ?? []);
}

/** Straight-line fallback (white base 8 px + colour top 5 px). */
function drawFallbackPolylines(
  positions: Array<{ lat: number; lng: number }>,
  color: string,
  map: google.maps.Map,
): [google.maps.Polyline, google.maps.Polyline] {
  const base = new google.maps.Polyline({
    path: positions, geodesic: true,
    strokeColor: '#ffffff', strokeOpacity: 0.9, strokeWeight: 8, zIndex: 1, map,
  });
  const top = new google.maps.Polyline({
    path: positions, geodesic: true,
    strokeColor: color, strokeOpacity: 0.85, strokeWeight: 5, zIndex: 2, map,
  });
  return [base, top];
}

// ─── Component ───────────────────────────────────────────────────────────────

const ItineraryMapInner = forwardRef<MapHandle, Props>(
  ({ activities, hotels, dayDate, showMarkers, dayIndex, activeActivityId, onMarkerClick, onRouteSegments }, ref) => {
    const containerRef   = useRef<HTMLDivElement>(null);
    const mapRef         = useRef<google.maps.Map | null>(null);
    const markerMapRef   = useRef<Map<string, google.maps.Marker>>(new Map());
    const markerIndexRef = useRef<Map<string, number>>(new Map());
    const hotelMarkerMapRef = useRef<Map<string, google.maps.Marker>>(new Map());
    /** Fallback straight-line layers (Directions API unavailable). */
    const polylineLayersRef  = useRef<google.maps.Polyline[]>([]);
    /** Gray background Polyline — full day route from all leg paths. */
    const bgPolylineRef      = useRef<google.maps.Polyline | null>(null);
    /** [white outline, colour fill] for the currently highlighted segment. */
    const highlightLayersRef = useRef<google.maps.Polyline[]>([]);
    const debounceTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Stored so we can remove it in cleanup if the component unmounts before idle fires. */
    const idleListenerRef    = useRef<google.maps.MapsEventListener | null>(null);
    const routeCache         = useRef<Map<string, google.maps.DirectionsResult>>(new Map());
    const onRouteSegmentsRef = useRef(onRouteSegments);
    useEffect(() => { onRouteSegmentsRef.current = onRouteSegments; });
    /** 本次繪製是否有 hotel origin；applyDirectionsResult 用來把第一 leg 切給 originSegment。 */
    const hotelOriginOffsetRef = useRef<0 | 1>(0);
    /** 本次繪製的 activity 數，用來把 legs 對齊到 segmentsFromEachActivity。 */
    const activityCountRef = useRef<number>(0);
    /** Ref mirror of onMarkerClick — kept in sync so the marker listener never goes stale
     *  even when React.memo skips re-renders (and the prop function reference changes). */
    const onMarkerClickRef = useRef(onMarkerClick);
    useEffect(() => { onMarkerClickRef.current = onMarkerClick; });

    /**
     * Directions API result for the current day.
     * Setting this (to a result or null) triggers the segment-highlight effect.
     * — null  : no route yet (loading, fallback, or single-point day)
     * — result: ready to draw highlights
     */
    const [dirResult, setDirResult] = useState<google.maps.DirectionsResult | null>(null);

    /**
     * Stable ref mirror of dirResult so the imperative handle can read it
     * synchronously (without being in the useImperativeHandle deps).
     */
    const dirResultRef = useRef<google.maps.DirectionsResult | null>(null);
    useEffect(() => { dirResultRef.current = dirResult; }, [dirResult]);

    // ── Inner helpers (access refs directly — no hooks) ──────────────────

    function clearRoute() {
      polylineLayersRef.current.forEach((p) => p.setMap(null));
      polylineLayersRef.current = [];
      bgPolylineRef.current?.setMap(null);
      bgPolylineRef.current = null;
      highlightLayersRef.current.forEach((p) => p.setMap(null));
      highlightLayersRef.current = [];
    }

    /**
     * Draw the gray full-route background from a DirectionsResult and
     * update the dirResult state (triggers the highlight effect).
     * NOT async — Directions library is already loaded by the caller.
     */
    function applyDirectionsResult(
      result: google.maps.DirectionsResult,
      map: google.maps.Map,
    ) {
      clearRoute();

      // Full route in soft gray — all leg paths concatenated
      const allPath = (result.routes[0]?.legs ?? []).flatMap(getLegPath);
      if (allPath.length > 0) {
        bgPolylineRef.current = new google.maps.Polyline({
          path: allPath, geodesic: true,
          strokeColor: '#D1D5DB', strokeOpacity: 0.5, strokeWeight: 3, zIndex: 1, map,
        });
      }

      // Update state → triggers the segment-highlight effect
      setDirResult(result);

      // Split legs into originSegment (hotel→first activity) and per-activity segments.
      // routePoints = [origin hotel?, ...activities, destination hotel?]
      // activity[i] 對應「從此站出發」的 leg index = i + offset
      const allLegs = result.routes[0]?.legs ?? [];
      const offset = hotelOriginOffsetRef.current;
      const activityCount = activityCountRef.current;
      const segmentsFromEachActivity: RouteSegment[] = Array.from({ length: activityCount }, (_, i) => {
        const leg = allLegs[i + offset];
        return leg
          ? { duration: leg.duration?.text ?? '', distance: leg.distance?.text ?? '' }
          : { duration: '', distance: '' };
      });
      const originSegment: RouteSegment | null = offset === 1 && allLegs[0]
        ? { duration: allLegs[0].duration?.text ?? '', distance: allLegs[0].distance?.text ?? '' }
        : null;
      onRouteSegmentsRef.current?.(segmentsFromEachActivity, originSegment);
    }

    // ── Imperative handle ────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      panToActivity: (activityId: string) => {
        const act = activities.find((a) => a.id === activityId);
        if (!mapRef.current) return;

        // Trigger BOUNCE on the marker regardless
        const marker = markerMapRef.current.get(activityId);
        if (marker) {
          marker.setAnimation(google.maps.Animation.BOUNCE);
          setTimeout(() => marker.setAnimation(null), 1400);
        }

        // Only hard-pan when no route is loaded — the highlight effect's
        // fitBounds will handle viewport positioning when dirResult is present.
        if (!dirResultRef.current && act?.lat && act?.lng) {
          mapRef.current.panTo({ lat: act.lat, lng: act.lng });
          mapRef.current.setZoom(16);
        }
      },
    }), [activities]);

    // ── Main effect: init → clear → draw markers + route ────────────────
    //
    // All google.maps.* classes are available synchronously here because
    // ItineraryMap is only rendered after loadGoogleMapsApi() resolves
    // (mapsReady guard in TripEditor). No importLibrary() needed.
    useEffect(() => {
      let cancelled = false;

      // Shared cleanup — always returned so every code-path releases resources.
      function doCleanup() {
        cancelled = true;
        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
          debounceTimer.current = null;
        }
        markerMapRef.current.forEach((m) => {
          google.maps.event.clearInstanceListeners(m);
          m.setMap(null);
        });
        markerMapRef.current.clear();
        markerIndexRef.current.clear();
        hotelMarkerMapRef.current.forEach((m) => {
          google.maps.event.clearInstanceListeners(m);
          m.setMap(null);
        });
        hotelMarkerMapRef.current.clear();
        if (idleListenerRef.current) {
          google.maps.event.removeListener(idleListenerRef.current);
          idleListenerRef.current = null;
        }
        clearRoute();
      }

      // Clear stale route result immediately so the highlight effect doesn't
      // display outdated segments during the debounce window.
      setDirResult(null);

      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }

      if (!containerRef.current) return doCleanup;

      // Lazy-init map (styles applied once at creation)
      if (!mapRef.current) {
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: { lat: 25.033, lng: 121.565 },
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          styles: MAP_STYLES,
        });
      }
      google.maps.event.trigger(mapRef.current, 'resize');

      markerMapRef.current.forEach((m) => {
        google.maps.event.clearInstanceListeners(m);
        m.setMap(null);
      });
      markerMapRef.current.clear();
      markerIndexRef.current.clear();
      hotelMarkerMapRef.current.forEach((m) => m.setMap(null));
      hotelMarkerMapRef.current.clear();
      clearRoute();

      if (!showMarkers) {
        hotelOriginOffsetRef.current = 0;
        activityCountRef.current = 0;
        onRouteSegmentsRef.current?.([], null);
        return doCleanup;
      }

      const valid = activities.filter(
        (a) => typeof a.lat === 'number' && typeof a.lng === 'number',
      );
      const validHotels = (hotels ?? []).filter(
        (h) => typeof h.lat === 'number' && typeof h.lng === 'number',
      );
      if (!valid.length && !validHotels.length) {
        hotelOriginOffsetRef.current = 0;
        activityCountRef.current = 0;
        onRouteSegmentsRef.current?.([], null);
        return doCleanup;
      }

      const positions = resolvePositions(valid);
      const dayColor  = getDayColor(dayIndex);
      const total     = valid.length;
      const bounds    = new google.maps.LatLngBounds();

      // ── Draw activity markers ────────────────────────────────────
      valid.forEach((act, i) => {
        const pos      = positions[i];
        const isActive = act.id === activeActivityId;

        const marker = new google.maps.Marker({
          position: pos,
          map: mapRef.current!,
          title: act.title || `景點 ${i + 1}`,
          zIndex: isActive ? 999 : total - i,
          label: { text: String(i + 1), color: '#ffffff', fontSize: '11px', fontWeight: '700' },
          icon: makeIcon(dayColor, isActive),
        });

        marker.addListener('click', () => onMarkerClickRef.current?.(act.id));
        markerMapRef.current.set(act.id, marker);
        markerIndexRef.current.set(act.id, i);
        bounds.extend(pos);
      });

      // ── Draw hotel markers (square + 'H' label) ──────────────────
      validHotels.forEach((h) => {
        const pos = { lat: h.lat as number, lng: h.lng as number };
        const marker = new google.maps.Marker({
          position: pos,
          map: mapRef.current!,
          title: h.name ? `🏨 ${h.name}` : '🏨 飯店',
          zIndex: 500,
          label: { text: 'H', color: '#ffffff', fontSize: '11px', fontWeight: '700' },
          icon: makeHotelIcon(dayColor),
        });
        marker.addListener('click', () => {
          marker.setAnimation(google.maps.Animation.BOUNCE);
          setTimeout(() => marker.setAnimation(null), 1400);
        });
        hotelMarkerMapRef.current.set(h.id, marker);
        bounds.extend(pos);
      });

      // ── fitBounds (full day) with zoom cap ───────────────────────
      const totalMarkers = valid.length + validHotels.length;
      if (totalMarkers === 1) {
        const only = valid.length === 1
          ? positions[0]
          : { lat: validHotels[0].lat as number, lng: validHotels[0].lng as number };
        mapRef.current.setCenter(only);
        mapRef.current.setZoom(15);
      } else {
        mapRef.current.fitBounds(bounds, FIT_PADDING);
        // Remove any previous idle listener that never fired
        if (idleListenerRef.current) {
          google.maps.event.removeListener(idleListenerRef.current);
        }
        idleListenerRef.current = google.maps.event.addListenerOnce(
          mapRef.current, 'idle', () => {
            idleListenerRef.current = null;
            const z = mapRef.current?.getZoom();
            if (z !== undefined && z > MAX_SAFE_ZOOM) mapRef.current!.setZoom(MAX_SAFE_ZOOM);
          },
        );
      }

      // ── Build route points (hotel origin + activities + hotel destination) ───
      const roles = resolveHotelRoles(validHotels, dayDate ?? '');
      const routePoints: Array<{ lat: number; lng: number }> = [];
      if (roles.origin) routePoints.push({ lat: roles.origin.lat as number, lng: roles.origin.lng as number });
      routePoints.push(...positions);
      if (roles.destination) {
        // Skip destination if it equals origin AND there's no activity in between
        // (Directions requires at least origin != destination or waypoints.length > 0 to draw a route)
        const sameAsOrigin = roles.origin && roles.origin.id === roles.destination.id;
        if (!sameAsOrigin || positions.length > 0) {
          routePoints.push({ lat: roles.destination.lat as number, lng: roles.destination.lng as number });
        }
      }

      // Stash for applyDirectionsResult so它能把 legs 切給 originSegment vs 活動段
      hotelOriginOffsetRef.current = roles.origin ? 1 : 0;
      activityCountRef.current = valid.length;

      if (routePoints.length < 2) {
        onRouteSegmentsRef.current?.([], null);
        return doCleanup;
      }

      const mapSnapshot = mapRef.current;

      // ── Directions API — debounced 500 ms ────────────────────────
      // Only ONE call per day-tab / activity list change thanks to the cache.
      // DirectionsService is available directly — no importLibrary needed.
      debounceTimer.current = setTimeout(() => {
        if (cancelled || !mapSnapshot) return;

        const originPt    = routePoints[0];
        const destPt      = routePoints[routePoints.length - 1];
        const midPts      = routePoints.slice(1, -1);
        const fingerprint = waypointKey(originPt, destPt, midPts);

        // Cache hit: no API call
        const cached = routeCache.current.get(fingerprint);
        if (cached) {
          applyDirectionsResult(cached, mapSnapshot);
          return;
        }

        try {
          const service = new google.maps.DirectionsService();
          const waypoints = midPts.map((p) => ({ location: p, stopover: true }));

          service.route(
            {
              origin: originPt, destination: destPt, waypoints,
              optimizeWaypoints: false,
              travelMode: google.maps.TravelMode.DRIVING,
            },
            (result, status) => {
              if (cancelled) return;

              if (status === google.maps.DirectionsStatus.OK && result) {
                routeCache.current.set(fingerprint, result);
                applyDirectionsResult(result, mapSnapshot);
              } else {
                // Fallback: two-layer straight polyline, no segment highlight
                console.warn(`Directions API ${status} — fallback to straight polyline`);
                clearRoute();
                polylineLayersRef.current = Array.from(
                  drawFallbackPolylines(routePoints, dayColor, mapSnapshot),
                );
                onRouteSegmentsRef.current?.([], null);
              }
            },
          );
        } catch (err) {
          if (cancelled) return;
          console.warn('Directions API error — fallback', err);
          clearRoute();
          polylineLayersRef.current = Array.from(
            drawFallbackPolylines(routePoints, dayColor, mapSnapshot),
          );
          onRouteSegmentsRef.current?.([]);
        }
      }, DIRECTIONS_DEBOUNCE_MS);

      return doCleanup;
    // activeActivityId excluded: handled by the segment-highlight effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activities, hotels, dayDate, showMarkers, dayIndex]);

    // ── Segment-highlight + marker-style effect ──────────────────────────
    //
    // Runs whenever:
    //  • activeActivityId changes (card/marker selected)
    //  • dirResult changes (route loaded or cleared)
    //  • dayIndex changes (colour)
    //
    // Does NOT call the Directions API — only reads the already-cached result.
    useEffect(() => {
      const dayColor = getDayColor(dayIndex);
      const total    = markerMapRef.current.size;

      // ① Update marker icon + z-index
      markerMapRef.current.forEach((marker, actId) => {
        const isActive = actId === activeActivityId;
        marker.setIcon(makeIcon(dayColor, isActive));
        marker.setZIndex(isActive ? 999 : total - (markerIndexRef.current.get(actId) ?? 0));
      });

      // ② Clear previous highlight polylines
      highlightLayersRef.current.forEach((p) => p.setMap(null));
      highlightLayersRef.current = [];

      if (!dirResult || !activeActivityId || !mapRef.current) return;

      // ③ Determine which leg to highlight
      const valid = activities.filter(
        (a) => typeof a.lat === 'number' && typeof a.lng === 'number',
      );
      const activeIndex = valid.findIndex((a) => a.id === activeActivityId);
      if (activeIndex === -1) return;

      const legs = dirResult.routes[0]?.legs ?? [];
      if (!legs.length) return;

      // routePoints = [origin hotel?, ...activities, destination hotel?]
      // 有 hotel origin 時，activity 在 routePoints 中的 index 需 +1
      const roles = dayDate
        ? resolveHotelRoles((hotels ?? []).filter((h) => h.lat != null && h.lng != null), dayDate)
        : { origin: undefined as { id: string } | undefined, destination: undefined as { id: string } | undefined };
      const hotelOriginOffset = roles.origin ? 1 : 0;
      const indexInRoute = activeIndex + hotelOriginOffset;

      // 若此 activity 在 routePoints 是最後一點（無 outgoing leg）→ 顯示 inbound leg
      // 否則 → 顯示 outgoing leg（含「最後一個 activity → hotel destination」的情境）
      const totalPoints = legs.length + 1;
      const isLastPoint = indexInRoute >= totalPoints - 1;
      const legIndex = isLastPoint ? legs.length - 1 : indexInRoute;
      const leg = legs[legIndex];
      if (!leg) return;

      const path = getLegPath(leg);
      if (!path.length) return;

      const map = mapRef.current;

      // ④ Draw highlight: white outline (8 px) + day colour (6 px)
      highlightLayersRef.current.push(
        new google.maps.Polyline({
          path, geodesic: true,
          strokeColor: '#ffffff', strokeOpacity: 1, strokeWeight: 8, zIndex: 10, map,
        }),
        new google.maps.Polyline({
          path, geodesic: true,
          strokeColor: dayColor, strokeOpacity: 1, strokeWeight: 6, zIndex: 11, map,
        }),
      );

      // ⑤ Zoom to the two endpoints of this segment
      const segBounds = new google.maps.LatLngBounds();
      segBounds.extend(leg.start_location);
      segBounds.extend(leg.end_location);
      map.fitBounds(segBounds, SEGMENT_FIT_PADDING);

      // Cleanup: remove highlight polylines when deps change or component unmounts
      return () => {
        highlightLayersRef.current.forEach((p) => p.setMap(null));
        highlightLayersRef.current = [];
      };

    // `activities` is intentionally omitted: any change to activities triggers
    // the main effect which resets dirResult → null, which in turn re-runs this
    // effect.  Adding activities here would cause a redundant extra run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeActivityId, dirResult, dayIndex, hotels, dayDate]);

    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
  },
);

ItineraryMapInner.displayName = 'ItineraryMap';

/**
 * Custom equality check: only re-render when map-relevant props change.
 * Non-map fields (title, notes, time, etc.) changing does NOT trigger
 * marker/route rebuild — preventing the OOM cascade on every keystroke.
 */
function arePropsEqual(prev: Props, next: Props): boolean {
  if (prev.showMarkers       !== next.showMarkers)       return false;
  if (prev.dayIndex          !== next.dayIndex)          return false;
  if (prev.dayDate           !== next.dayDate)           return false;
  if (prev.activeActivityId  !== next.activeActivityId)  return false;
  if (prev.activities.length !== next.activities.length) return false;
  for (let i = 0; i < prev.activities.length; i++) {
    const a = prev.activities[i], b = next.activities[i];
    if (a.id !== b.id || a.lat !== b.lat || a.lng !== b.lng) return false;
  }
  const prevHotels = prev.hotels ?? [];
  const nextHotels = next.hotels ?? [];
  if (prevHotels.length !== nextHotels.length) return false;
  for (let i = 0; i < prevHotels.length; i++) {
    const a = prevHotels[i], b = nextHotels[i];
    if (a.id !== b.id || a.lat !== b.lat || a.lng !== b.lng) return false;
  }
  return true; // identical from the map's perspective → skip re-render
  // onMarkerClick / onRouteSegments are intentionally excluded:
  // they are kept current via onMarkerClickRef / onRouteSegmentsRef inside.
}

const ItineraryMap = memo(ItineraryMapInner, arePropsEqual);
export default ItineraryMap;
