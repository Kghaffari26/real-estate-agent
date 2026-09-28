import { Info, LayoutDashboard, Map as MapIcon, Rows3 } from 'lucide-react';

export const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/metros', label: 'Metros', icon: MapIcon, end: false },
  { to: '/compare', label: 'Compare', icon: Rows3, end: false },
  { to: '/about', label: 'Methodology', icon: Info, end: false },
] as const;
