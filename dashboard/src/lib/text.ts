/**
 * Split narrative text into sentences for the Arrival story. A sentence ends at a
 * period after a lowercase letter, digit, % or ")" and before a capital, so
 * initialisms ("U.S. median") and decimals ("7.03%") never split.
 */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[a-z0-9%)]\.)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
