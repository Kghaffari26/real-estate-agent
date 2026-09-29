/**
 * The motion language (spec §5.4) as data, shared by framer-motion components,
 * the rAF counters, GSAP timelines and MapLibre camera moves.
 *
 * Every animation must explain or guide (anti-slop #8). Under
 * prefers-reduced-motion: no flights, no count-ups, no autoplay, instant panels.
 */
import type { Transition, Variants } from 'framer-motion';

/** cubic-bezier(.2,.8,.2,1): the house ease for micro interactions and reveals. */
export const EASE = [0.2, 0.8, 0.2, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

/** Seconds (framer-motion / GSAP units). */
export const DUR = {
  micro: 0.15, // hover, press: 120–180 ms
  panel: 0.32, // panel enter/exit: 280–380 ms
  count: 0.75, // number count-up: 600–900 ms
  draw: 0.9, // a chart line drawing left → right, first view only
  camera: 1.8, // camera moves: 1.2–2.4 s
} as const;

/** Panels move on a spring (stiffness ~260, damping ~30). */
export const SPRING_PANEL: Transition = { type: 'spring', stiffness: 260, damping: 30, mass: 1 };
export const MICRO: Transition = { duration: DUR.micro, ease: EASE };

/** Siblings enter 40 ms apart. */
export const STAGGER = 0.04;

export const panelVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  shown: { opacity: 1, y: 0, scale: 1, transition: SPRING_PANEL },
  exit: { opacity: 0, y: 8, transition: { duration: DUR.micro, ease: EASE } },
};

export const staggerVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: STAGGER } },
};

export const riseVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: { duration: DUR.panel, ease: EASE } },
};

/** MapLibre `flyTo` options for camera moves; `essential: false` lets reduced motion skip them. */
export const CAMERA_FLIGHT = { duration: DUR.camera * 1000, curve: 1.4, essential: false } as const;

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** GSAP + ScrollTrigger, loaded only by the routes that use them (Arrival). */
export async function loadGsap() {
  const [{ gsap }, { ScrollTrigger }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger')]);
  gsap.registerPlugin(ScrollTrigger);
  return { gsap, ScrollTrigger };
}
