/**
 * Methodology copy for the About page, transcribed from docs/specs/SPEC_REAL_ESTATE.md
 * §5.3 (temperature) and §5.4 (flags, default thresholds from config/real_estate.toml).
 * Update it together with the spec.
 */
export const TEMPERATURE_STEPS: readonly string[] = [
  'Six components are z-scored across the tracked metros at the latest month: sale-to-list ratio (+), share sold above list (+), share off market in two weeks (+), median days on market (−), share of listings with price drops (−) and months of supply (−).',
  'The raw score is the mean of the available signed z-scores; at least 4 of the 6 are required, otherwise there is no score.',
  'The score is 100 × Φ(raw score), where Φ is the standard normal CDF, so it runs from 0 to 100.',
  'Labels: 80 and above Hot, 60–79 Warm, 40–59 Balanced, 20–39 Cool, below 20 Cold.',
  "Market type is separate and absolute, from months of supply: under 3 is a seller's market, 3–6 balanced, over 6 a buyer's market.",
  'The national temperature compares the national series with its own 36-month history (a time z-score) instead of with other metros.',
];

export const FLAG_RULES: ReadonlyArray<{ id: string; rule: string; severity: string }> = [
  { id: 'inventory_surge', rule: 'Inventory YoY ≥ +25%', severity: 'notable (major at ≥ +50%)' },
  { id: 'inventory_drop', rule: 'Inventory YoY ≤ −20%', severity: 'notable' },
  { id: 'price_decline', rule: 'Median sale price YoY ≤ −3%', severity: 'notable (major at ≤ −8%)' },
  { id: 'price_surge', rule: 'Median sale price YoY ≥ +8%', severity: 'notable' },
  { id: 'price_36m_high', rule: 'Median sale price is at its 36-month high', severity: 'info' },
  { id: 'price_36m_low', rule: 'Median sale price is at its 36-month low', severity: 'info' },
  { id: 'price_cuts_high', rule: 'Price-drop share at a 36-month high and up ≥ 3 pp YoY', severity: 'notable' },
  { id: 'slowing', rule: 'Median days on market up ≥ 10 days YoY', severity: 'info' },
  { id: 'buyers_market', rule: 'Months of supply crossed above 6 this month', severity: 'notable' },
  { id: 'sellers_market', rule: 'Months of supply crossed below 3 this month', severity: 'notable' },
  { id: 'rent_outpacing', rule: 'Rent (ZORI) YoY minus home value (ZHVI) YoY ≥ 3 pp', severity: 'info' },
  { id: 'permits_boom', rule: '12-month permits YoY ≥ +30%', severity: 'info' },
  { id: 'permits_bust', rule: '12-month permits YoY ≤ −30%', severity: 'info' },
  { id: 'payment_jump', rule: 'Monthly payment on the median home up ≥ 10% YoY', severity: 'notable' },
];
