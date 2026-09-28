import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useIsMobile } from '../../hooks/useMediaQuery';

/**
 * On phones, long pages collapse into sections (a disclosure button per section);
 * on larger screens the content is always shown and the header is a plain heading.
 */
export function Collapsible({ title, defaultOpen = false, children, id }: { title: string; defaultOpen?: boolean; children: ReactNode; id?: string }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  if (!mobile) return <>{children}</>;
  return (
    <div id={id} className="scroll-mt-20">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="card flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
        >
          {title}
          <ChevronDown aria-hidden="true" className={`h-4 w-4 text-text-3 transition-transform duration-2 ${open ? 'rotate-180' : ''}`} />
        </button>
      </h2>
      <div id={panelId} hidden={!open} className="mt-3">
        {children}
      </div>
    </div>
  );
}
