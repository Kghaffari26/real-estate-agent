/** RFC 4180 CSV (quotes only where needed) and a browser download helper. */
export type CsvValue = string | number | null | undefined;

export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const cell = (v: CsvValue) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugifyFilename(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
}
