import type { ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  /** Heading level for the title (keeps the document outline valid per page). */
  level?: 2 | 3;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
  id?: string;
}

export function Card({ title, level = 2, actions, footer, className = '', children, id }: CardProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section className={`card min-w-0 ${className}`} id={id} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && (
            <Heading className="card-title" id={id ? `${id}-title` : undefined}>
              {title}
            </Heading>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
      {footer && <div className="mt-3 text-xs muted">{footer}</div>}
    </section>
  );
}
