import { useEffect } from 'react';

const SITE = 'Housing Market Dashboard';

export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : SITE;
  }, [title]);
}
