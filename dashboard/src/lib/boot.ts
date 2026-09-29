/**
 * The pre-JS poster in index.html (#boot, Arrival only). Removed once the page's own
 * poster has painted, or right away on any other route, so it never covers the app.
 */
export function removeBoot(): void {
  document.getElementById('boot')?.remove();
}
