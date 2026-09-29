import type { ElementType, HTMLAttributes, ReactNode } from 'react';

type GlassProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  /** Solid background: for panels over busy content, and always under prefers-reduced-transparency. */
  solid?: boolean;
  /** Film grain over the panel (decorative). */
  grain?: boolean;
  children?: ReactNode;
};

/**
 * The floating panel of the atlas: translucent, 20 px blur, a 1 px inner highlight.
 * Text on it passes 4.5:1 even over the brightest column (see atlas.css).
 */
export function GlassPanel({ as: Tag = 'div', solid = false, grain = false, className = '', style, children, ...rest }: GlassProps) {
  return (
    <Tag
      className={`mp-glass ${/\b(absolute|fixed|sticky)\b/.test(className) ? '' : 'relative'} ${className}`}
      style={solid ? { ...style, background: 'rgb(var(--mp-panel))', backdropFilter: 'none' } : style}
      {...rest}
    >
      {grain && <span className="mp-grain rounded-[inherit]" aria-hidden="true" />}
      {children}
    </Tag>
  );
}
