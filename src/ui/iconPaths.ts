/**
 * Icon geometry on a 24×24 grid (stroke icons, 2 px, round caps), shared by
 * the `Icon` component. Kept free of React Native imports so pure modules can
 * reference `IconName`.
 */
export type IconShape =
  | { kind: 'path'; d: string }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number };

const path = (d: string): IconShape => ({ kind: 'path', d });
const circle = (cx: number, cy: number, r: number): IconShape => ({ kind: 'circle', cx, cy, r });
const rect = (x: number, y: number, width: number, height: number, rx: number): IconShape => ({
  kind: 'rect',
  x,
  y,
  width,
  height,
  rx,
});

export const ICONS = {
  home: [path('M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z')],
  search: [circle(11, 11, 7), path('m20 20-4-4')],
  library: [path('M5 3v18M10 3v18M15 4l5 16.5')],
  gear: [
    circle(12, 12, 3),
    path(
      'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    ),
  ],
  play: [path('M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z')],
  pause: [rect(6, 4, 4, 16, 1.2), rect(14, 4, 4, 16, 1.2)],
  stop: [rect(6, 6, 12, 12, 2)],
  // The bar is a rect so it still shows when the icon is drawn filled.
  next: [path('M5 5.5v13a1 1 0 0 0 1.6.8l9-6.5a1 1 0 0 0 0-1.6l-9-6.5A1 1 0 0 0 5 5.5z'), rect(16.6, 5, 2.4, 14, 1)],
  prev: [path('M19 5.5v13a1 1 0 0 1-1.6.8l-9-6.5a1 1 0 0 1 0-1.6l9-6.5A1 1 0 0 1 19 5.5z'), rect(5, 5, 2.4, 14, 1)],
  back10: [path('M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4')],
  fwd10: [path('M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4')],
  down: [path('m6 9 6 6 6-6')],
  right: [path('m9 6 6 6-6 6')],
  left: [path('m15 6-6 6 6 6')],
  more: [circle(5, 12, 1.3), circle(12, 12, 1.3), circle(19, 12, 1.3)],
  moreVertical: [circle(12, 5, 1.3), circle(12, 12, 1.3), circle(12, 19, 1.3)],
  plus: [path('M12 5v14M5 12h14')],
  shuffle: [
    path(
      'M3 7h3.5c2 0 3.3 1 4.5 2.8l2 3.4C14.2 15 15.5 16 17.5 16H21M3 17h3.5c1.4 0 2.4-.5 3.3-1.4M14.2 8.4c.9-.9 1.9-1.4 3.3-1.4H21M18 4l3 3-3 3M18 13l3 3-3 3',
    ),
  ],
  repeat: [path('M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4')],
  download: [path('M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14')],
  playNext: [path('M3 6h11M3 12h11M3 18h7M16 9l5 3-5 3z')],
  heart: [
    path(
      'M12 20s-7.5-4.6-9.3-9.3C1.5 7.4 3.7 4 7.2 4c2 0 3.6 1.1 4.8 2.8C13.2 5.1 14.8 4 16.8 4c3.5 0 5.7 3.4 4.5 6.7C19.5 15.4 12 20 12 20z',
    ),
  ],
  queue: [path('M3 6h13M3 12h13M3 18h8M18 15v6l4-3z')],
  peer: [
    circle(6, 12, 2.5),
    circle(18, 6, 2.5),
    circle(18, 18, 2.5),
    path('m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6'),
  ],
  bolt: [path('M13 2 4 14h7l-1 8 9-12h-7z')],
  clock: [circle(12, 12, 9), path('M12 7v5l3 2')],
  x: [path('M6 6l12 12M18 6 6 18')],
  check: [path('m5 12.5 4.5 4.5L19 7.5')],
  refresh: [path('M20 11a8 8 0 0 0-14.3-4.6L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.6L20 16M20 20v-4h-4')],
  swap: [path('M4 8h13l-3-3M20 16H7l3 3')],
  offline: [
    path(
      'M2 8.8a15 15 0 0 1 4.2-2.5M10.7 5a15 15 0 0 1 11.3 3.8M5 12.5a10 10 0 0 1 5.2-2.6M16.8 10.7a10 10 0 0 1 2.2 1.8M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18',
    ),
  ],
  lock: [rect(4, 11, 16, 10, 2), path('M8 11V7a4 4 0 0 1 8 0v4')],
  wave: [path('M3 12h2M7 8v8M11 4v16M15 7v10M19 10v4M21 12h0')],
  server: [rect(3, 4, 18, 7, 2), rect(3, 13, 18, 7, 2), path('M7 7.5h.01M7 16.5h.01')],
  info: [circle(12, 12, 9), path('M12 11v6M12 7.5h.01')],
  logout: [path('M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3')],
  music: [path('M9 18V5l12-2v13'), circle(6, 18, 3), circle(18, 16, 3)],
  user: [circle(12, 8, 4), path('M4 21a8 8 0 0 1 16 0')],
  disc: [circle(12, 12, 9), circle(12, 12, 2.5)],
  share: [circle(18, 5, 2.6), circle(6, 12, 2.6), circle(18, 19, 2.6), path('m8.4 13.3 7.2 4.4M15.6 6.3l-7.2 4.4')],
} satisfies Record<string, IconShape[]>;

export type IconName = keyof typeof ICONS;
