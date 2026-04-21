import { describe, it, expect } from 'vitest';
import type { HotelInfo } from '@/types/trip';
import { hotelsCoveringDay, resolveHotelRoles } from './hotels';

const H = (overrides: Partial<HotelInfo>): HotelInfo => ({
  id: overrides.id ?? crypto.randomUUID(),
  name: overrides.name ?? 'Hotel',
  checkIn: overrides.checkIn ?? '',
  checkOut: overrides.checkOut ?? '',
  address: overrides.address ?? '',
  confirmationNumber: overrides.confirmationNumber ?? '',
  lat: overrides.lat,
  lng: overrides.lng,
  placeId: overrides.placeId,
});

describe('hotelsCoveringDay', () => {
  const A = H({ id: 'A', checkIn: '2026-05-01', checkOut: '2026-05-03', lat: 1, lng: 2 });

  it('includes days within checkIn..checkOut inclusive', () => {
    expect(hotelsCoveringDay([A], '2026-05-01').map((h) => h.id)).toEqual(['A']);
    expect(hotelsCoveringDay([A], '2026-05-02').map((h) => h.id)).toEqual(['A']);
    expect(hotelsCoveringDay([A], '2026-05-03').map((h) => h.id)).toEqual(['A']);
  });

  it('excludes days outside range', () => {
    expect(hotelsCoveringDay([A], '2026-04-30')).toEqual([]);
    expect(hotelsCoveringDay([A], '2026-05-04')).toEqual([]);
  });

  it('filters out hotels with no coordinates', () => {
    const noCoord = H({ id: 'X', checkIn: '2026-05-01', checkOut: '2026-05-03' });
    expect(hotelsCoveringDay([noCoord], '2026-05-02')).toEqual([]);
  });

  it('filters out hotels with missing checkIn/checkOut', () => {
    const missing = H({ id: 'Y', checkIn: '', checkOut: '2026-05-03', lat: 1, lng: 2 });
    expect(hotelsCoveringDay([missing], '2026-05-02')).toEqual([]);
  });

  it('tolerates isoDate with time component', () => {
    expect(hotelsCoveringDay([A], '2026-05-02T09:00:00Z').map((h) => h.id)).toEqual(['A']);
  });
});

describe('resolveHotelRoles', () => {
  const A = H({ id: 'A', checkIn: '2026-05-01', checkOut: '2026-05-03', lat: 1, lng: 2 });
  const B = H({ id: 'B', checkIn: '2026-05-03', checkOut: '2026-05-05', lat: 3, lng: 4 });

  it('middle day of one hotel: origin == destination', () => {
    const r = resolveHotelRoles([A], '2026-05-02');
    expect(r.origin?.id).toBe('A');
    expect(r.destination?.id).toBe('A');
    expect(r.all.map((h) => h.id)).toEqual(['A']);
  });

  it('checkIn day (first day): only destination', () => {
    const r = resolveHotelRoles([A], '2026-05-01');
    expect(r.origin).toBeUndefined();
    expect(r.destination?.id).toBe('A');
  });

  it('checkOut day (last day): only origin', () => {
    const r = resolveHotelRoles([A], '2026-05-03');
    expect(r.origin?.id).toBe('A');
    expect(r.destination).toBeUndefined();
  });

  it('cross-hotel day (A.checkOut == B.checkIn): origin = A, destination = B', () => {
    const r = resolveHotelRoles([A, B], '2026-05-03');
    expect(r.origin?.id).toBe('A');
    expect(r.destination?.id).toBe('B');
    expect(r.all.map((h) => h.id).sort()).toEqual(['A', 'B']);
  });

  it('returns empty roles when no hotels cover the day', () => {
    const r = resolveHotelRoles([A], '2026-06-01');
    expect(r.origin).toBeUndefined();
    expect(r.destination).toBeUndefined();
    expect(r.all).toEqual([]);
  });
});
