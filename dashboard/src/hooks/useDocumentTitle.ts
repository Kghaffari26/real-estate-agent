import { useEffect } from 'react';
import { BRAND } from '../config/brand';

export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${BRAND.name}` : BRAND.name;
  }, [title]);
}
