import { BookOpen, Briefcase, Info, Map as MapIcon, Rows3 } from 'lucide-react';

// The pages the ⌘K palette offers (the command bar's links are hidden on phones, so this is their way in).
export const NAV_ITEMS = [
  { to: '/', label: 'Brief', icon: BookOpen, end: true },
  { to: '/explore', label: 'Atlas', icon: MapIcon, end: false },
  { to: '/compare', label: 'Compare', icon: Rows3, end: false },
  { to: '/methodology', label: 'Methodology', icon: Info, end: false },
  { to: '/desk', label: 'Desk', icon: Briefcase, end: false },
] as const;
