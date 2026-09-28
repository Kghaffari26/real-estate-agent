import { Download, Link2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useToast } from '../../hooks/Toast';
import { shareUrl } from '../../hooks/useSectionLink';
import { copyText } from '../../lib/clipboard';

interface CardProps {
  id?: string;
  title?: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  level?: 2 | 3;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Show a "Copy link to this section" button (needs `id`). */
  copyLink?: boolean;
  /** Show "Download PNG" for the SVG chart(s) inside. */
  exportTitle?: string;
  exportSubtitle?: string;
  bodyClassName?: string;
}

export function Card({ id, title, eyebrow, subtitle, level = 2, actions, footer, children, className = '', copyLink, exportTitle, exportSubtitle, bodyClassName = 'card-pad' }: CardProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const ref = useRef<HTMLElement>(null);
  const toast = useToast();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const titleId = id ? `${id}-title` : undefined;
  const hasHeader = title || actions || copyLink || exportTitle;

  const onCopy = async () => {
    const ok = await copyText(shareUrl(location.pathname, location.search, id));
    toast(ok ? 'Link copied' : "Couldn't copy the link");
  };
  const onExport = async () => {
    if (!ref.current || !exportTitle) return;
    setBusy(true);
    try {
      const { exportSvgAsPng } = await import('../../lib/exportPng');
      await exportSvgAsPng(ref.current, exportTitle, exportSubtitle);
      toast('PNG downloaded');
    } catch {
      toast("Couldn't export this chart");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section ref={ref} id={id} aria-labelledby={title ? titleId : undefined} className={`card scroll-mt-20 ${className}`}>
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 pt-4 sm:flex-nowrap sm:px-5 sm:pt-5">
          <div className="min-w-0 flex-1 basis-60">
            {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
            {title && (
              <Heading id={titleId} className="text-md font-semibold leading-6">
                {title}
              </Heading>
            )}
            {subtitle && <p className="mt-0.5 text-sm text-text-3">{subtitle}</p>}
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end" data-no-print>
            {actions}
            {(copyLink || exportTitle) && (
              <div className="flex items-center">
                {copyLink && id && (
                  <button type="button" className="btn btn-ghost btn-icon" onClick={onCopy} aria-label="Copy link to this section" title="Copy link">
                    <Link2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}
                {exportTitle && (
                  <button type="button" className="btn btn-ghost btn-icon" onClick={onExport} disabled={busy} aria-label={`Download PNG of ${exportTitle}`} title="Download PNG">
                    <Download aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </header>
      )}
      <div className={hasHeader ? bodyClassName.replace('card-pad', 'px-4 pb-4 pt-3 sm:px-5 sm:pb-5') : bodyClassName}>{children}</div>
      {footer && <footer className="border-t border-border px-4 py-2.5 text-xs text-text-3 sm:px-5">{footer}</footer>}
    </section>
  );
}
