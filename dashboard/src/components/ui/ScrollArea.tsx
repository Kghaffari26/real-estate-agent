import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A horizontally (optionally vertically) scrolling region with edge cues: a fade on
 * the right while more columns are hidden, and `data-scrolled` so a sticky first
 * column can cast a shadow once content slides under it.
 */
export function ScrollArea({ label, children, className = '', maxHeight = false }: { label: string; children: ReactNode; className?: string; maxHeight?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className={`relative rounded-md border border-border ${className}`}>
      <div
        ref={ref}
        tabIndex={0}
        role="region"
        aria-label={label}
        data-scrolled={edges.left ? 'true' : 'false'}
        className={`group/scroll relative max-w-full overflow-x-auto rounded-md ${maxHeight ? 'max-h-[70vh] overflow-y-auto' : ''}`}
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        data-testid="scroll-fade-right"
        className={`pointer-events-none absolute inset-y-0 right-0 z-20 w-10 rounded-r-md bg-gradient-to-l from-surface via-surface/70 to-transparent transition-opacity duration-2 ${edges.right ? 'opacity-100' : 'opacity-0'}`}
      />
      {edges.right && <span className="sr-only">Scroll horizontally for more columns.</span>}
    </div>
  );
}
