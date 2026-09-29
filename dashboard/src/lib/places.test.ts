import { describe, expect, it } from 'vitest';
import { nearestPlace } from './places';

const irvineClick = { lat: 33.6846, lon: -117.8265 };
const places = [
  { name: 'Irvine', cls: 'city', lat: 33.6857, lon: -117.8253 },
  { name: 'Woodbridge', cls: 'suburb', lat: 33.6726, lon: -117.8013 },
  { name: 'Tustin', cls: 'city', lat: 33.7459, lon: -117.8262 },
  { name: 'Anaheim', cls: 'city', lat: 33.8366, lon: -117.9143 },
  { name: 'Somewhere', cls: 'continent', lat: 33.68, lon: -117.82 },
];

describe('naming a pin after the place under it', () => {
  it('prefers the nearby city over a closer-in neighborhood, and never a far metro', () => {
    expect(nearestPlace(places, irvineClick)?.name).toBe('Irvine');
    expect(nearestPlace(places, { lat: 33.6726, lon: -117.8013 })?.name).toBe('Woodbridge'); // right on it
    expect(nearestPlace(places, { lat: 34.5, lon: -117 })).toBeNull(); // nothing within 6 mi
    expect(nearestPlace([], irvineClick)).toBeNull();
  });
});
