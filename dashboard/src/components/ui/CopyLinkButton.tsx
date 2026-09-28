import { Link2 } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useToast } from '../../hooks/Toast';
import { shareUrl } from '../../hooks/useSectionLink';
import { copyText } from '../../lib/clipboard';

/** Copies the current view's deep link (every setting lives in the URL). */
export function CopyLinkButton({ label = 'Copy link' }: { label?: string }) {
  const location = useLocation();
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        const ok = await copyText(shareUrl(location.pathname, location.search));
        toast(ok ? 'Link copied' : "Couldn't copy the link");
      }}
    >
      <Link2 aria-hidden="true" className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
