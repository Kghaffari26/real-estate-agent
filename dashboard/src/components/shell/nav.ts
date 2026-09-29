import { BookOpen, Info, Map as MapIcon, Rows3 } from 'lucide-react';

// The v1 shell now frames only Compare and Methodology; its nav points at the v2 screens.
export const NAV_ITEMS = [
  { to: '/', label: 'Brief', icon: BookOpen, end: true },
  { to: '/explore', label: 'Atlas', icon: MapIcon, end: false },
  { to: '/compare', label: 'Compare', icon: Rows3, end: false },
  { to: '/about', label: 'Methodology', icon: Info, end: false },
] as const;
