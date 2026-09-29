import { describe, expect, it } from 'vitest';
import { sentences } from './text';

describe('sentences', () => {
  it('splits at sentence ends but not at initialisms or decimals', () => {
    expect(sentences('Prices rose 2.2% in the U.S. market. Inventory fell (slightly). The 30-year rate was 7.03%. Done.')).toEqual([
      'Prices rose 2.2% in the U.S. market.',
      'Inventory fell (slightly).',
      'The 30-year rate was 7.03%.',
      'Done.',
    ]);
    expect(sentences('')).toEqual([]);
  });
});
