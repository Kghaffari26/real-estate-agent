/**
 * "Download PNG" for SVG charts. CSS variables don't survive serialization, so each
 * cloned node gets its computed paint inlined before drawing onto a canvas at 2×.
 */
import { downloadBlob, slugifyFilename } from './csv';
import { BRAND } from '../config/brand';

const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'fill-opacity', 'opacity', 'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'] as const;

function inlineStyles(source: Element, target: Element) {
  const computed = getComputedStyle(source);
  const style = PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(';');
  target.setAttribute('style', style);
  const s = source.children;
  const t = target.children;
  for (let i = 0; i < s.length; i++) inlineStyles(s[i]!, t[i]!);
}

export async function exportSvgAsPng(container: HTMLElement, title: string, subtitle?: string): Promise<void> {
  const svgs = [...container.querySelectorAll('svg')].filter((s) => s.getBoundingClientRect().width > 120);
  if (svgs.length === 0) return;
  const scale = 2;
  const pad = 24;
  const header = 56;
  const width = Math.max(...svgs.map((s) => s.getBoundingClientRect().width));
  const heights = svgs.map((s) => s.getBoundingClientRect().height);
  const height = heights.reduce((a, b) => a + b, 0) + header + pad * 2 + 20;
  const root = getComputedStyle(document.documentElement);
  const rgb = (v: string) => `rgb(${root.getPropertyValue(v).trim().split(/\s+/).join(',')})`;

  const canvas = document.createElement('canvas');
  canvas.width = (width + pad * 2) * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  ctx.fillStyle = rgb('--color-surface');
  ctx.fillRect(0, 0, width + pad * 2, height);
  const font = root.getPropertyValue('--font-sans');
  ctx.fillStyle = rgb('--color-text');
  ctx.font = `600 16px ${font}`;
  ctx.fillText(title, pad, pad + 16);
  if (subtitle) {
    ctx.fillStyle = rgb('--color-text-3');
    ctx.font = `400 12px ${font}`;
    ctx.fillText(subtitle, pad, pad + 36);
  }

  let y = pad + header;
  for (const [i, svg] of svgs.entries()) {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    inlineStyles(svg, clone);
    const box = svg.getBoundingClientRect();
    clone.setAttribute('width', String(box.width));
    clone.setAttribute('height', String(box.height));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('SVG render failed'));
        img.src = url;
      });
      ctx.drawImage(img, pad, y, box.width, box.height);
    } finally {
      URL.revokeObjectURL(url);
    }
    y += heights[i]!;
  }
  ctx.fillStyle = rgb('--color-text-3');
  ctx.font = `400 11px ${font}`;
  ctx.fillText(`${BRAND.name} · Data: Redfin, Zillow, FRED, U.S. Census Bureau`, pad, height - pad / 2);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob) downloadBlob(blob, `${slugifyFilename(title)}.png`);
}
