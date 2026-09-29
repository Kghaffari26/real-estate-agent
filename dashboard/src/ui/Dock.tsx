import { ChevronLeft, Layers } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { GlassPanel } from './Glass';

interface DockProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  side?: 'left' | 'right';
  className?: string;
  icon?: ReactNode;
}

/** A collapsible floating dock (the atlas's layer dock and context panel). */
export function Dock({ title, children, defaultOpen = true, side = 'left', className = '', icon = <Layers size={14} strokeWidth={1.5} aria-hidden="true" /> }: DockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <GlassPanel as="aside" aria-label={title} className={`${open ? 'p-4' : 'p-2'} ${className}`}>
      <div className="flex items-center gap-2">
        <span className="mp-label flex items-center gap-2">
          {icon}
          {open && title}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? `Collapse ${title.toLowerCase()}` : `Expand ${title.toLowerCase()}`}
          onClick={() => setOpen((v) => !v)}
          className="grid h-7 w-7 place-items-center rounded-control text-mp-ink-3 hover:bg-mp-ink/[.06] hover:text-mp-ink"
        >
          <ChevronLeft size={16} strokeWidth={1.5} className={`transition-transform duration-panel ease-mp ${open === (side === 'left') ? '' : 'rotate-180'}`} aria-hidden="true" />
        </button>
      </div>
      <div id={bodyId} hidden={!open} className="mt-3">
        {children}
      </div>
    </GlassPanel>
  );
}
