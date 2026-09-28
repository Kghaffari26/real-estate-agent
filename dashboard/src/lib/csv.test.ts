import { describe, expect, it } from 'vitest';
import { slugifyFilename, toCsv } from './csv';

describe('toCsv', () => {
  it('quotes only where needed and keeps raw numbers', () => {
    expect(toCsv(['metro', 'price'], [['Austin, TX', 441000], ['Say "hi"', null]])).toBe(
      'metro,price\r\n"Austin, TX",441000\r\n"Say ""hi""",\r\n',
    );
  });
  it('slugifies filenames', () => {
    expect(slugifyFilename('Median sale price — Austin, TX')).toBe('median-sale-price-austin-tx');
  });
});
