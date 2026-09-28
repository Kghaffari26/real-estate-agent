/** Small line illustrations for empty/error states. Token-colored, decorative. */
export function EmptyIllustration() {
  return (
    <svg viewBox="0 0 120 80" className="h-16 w-24 text-text-3" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="14" y="18" width="92" height="50" rx="6" className="text-border-strong" stroke="currentColor" />
      <path d="M24 56h72" strokeDasharray="3 4" />
      <path d="M24 50l14-10 12 6 14-14 12 8 20-12" className="text-accent" stroke="currentColor" strokeOpacity=".5" />
      <circle cx="96" cy="28" r="2.5" className="text-accent" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ErrorIllustration() {
  return (
    <svg viewBox="0 0 120 80" className="h-16 w-24" aria-hidden="true" fill="none" strokeWidth="1.5" strokeLinecap="round">
      <rect x="14" y="18" width="92" height="50" rx="6" stroke="rgb(var(--color-border-strong))" />
      <path d="M24 50l14-10 12 6 8-8" stroke="rgb(var(--color-text-3))" />
      <path d="M62 36l6 6m0-6l-6 6" stroke="rgb(var(--color-bad))" strokeWidth="2" />
      <path d="M74 44l22-16" stroke="rgb(var(--color-text-3))" strokeDasharray="3 4" />
    </svg>
  );
}

export function NotFoundIllustration() {
  return (
    <svg viewBox="0 0 120 80" className="h-20 w-32" aria-hidden="true" fill="none" strokeWidth="1.5" strokeLinecap="round">
      <path d="M20 66V40l14-10 14 10v26M58 66V28l14-12 14 12v38M92 66V46l10-8 8 8v20" stroke="rgb(var(--color-border-strong))" />
      <circle cx="60" cy="46" r="11" stroke="rgb(var(--color-accent))" />
      <path d="M68 54l9 9" stroke="rgb(var(--color-accent))" strokeWidth="2.5" />
      <path d="M12 66h100" stroke="rgb(var(--color-text-3))" />
    </svg>
  );
}
