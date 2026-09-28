import { describe, expect, it } from 'vitest';
import { assignSlots } from './EntityColors';

describe('assignSlots', () => {
  it('hands out first-free slots and never repaints survivors', () => {
    const a = assignSlots(new Map(), ['pit', 'hou', 'bos'], 4);
    expect([...a]).toEqual([['pit', 0], ['hou', 1], ['bos', 2]]);
    const b = assignSlots(a, ['pit', 'bos'], 4); // remove Houston
    expect(b.get('bos')).toBe(2);
    const c = assignSlots(b, ['pit', 'bos', 'aus'], 4); // Austin takes the freed slot
    expect(c.get('aus')).toBe(1);
  });
});
