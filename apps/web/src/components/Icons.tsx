/**
 * Icon set.
 *
 * Hand-drawn 16px strokes on a shared grid rather than an icon dependency. There are ten of them,
 * which is all this product needs.
 */
type P = { className?: string };
const base = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const IconSearch = (p: P) => (
  <svg {...base} {...p}><circle cx="7" cy="7" r="4.25" /><path d="M10.2 10.2 13.5 13.5" /></svg>
);
export const IconBookmark = (p: P) => (
  <svg {...base} {...p}><path d="M4 2.5h8v11l-4-2.8-4 2.8v-11Z" /></svg>
);
export const IconSparkle = (p: P) => (
  <svg {...base} {...p}><path d="M8 2 9.3 6 13.5 7.3 9.3 8.6 8 12.6 6.7 8.6 2.5 7.3 6.7 6 8 2Z" /><path d="M12.6 11.4 13.1 12.9 14.6 13.4 13.1 13.9 12.6 15.4 12.1 13.9 10.6 13.4 12.1 12.9 12.6 11.4Z" /></svg>
);
export const IconDownload = (p: P) => (
  <svg {...base} {...p}><path d="M8 2.5v7.5" /><path d="m5 7.2 3 3 3-3" /><path d="M2.8 12.2v.8a.8.8 0 0 0 .8.8h8.8a.8.8 0 0 0 .8-.8v-.8" /></svg>
);
export const IconSettings = (p: P) => (
  <svg {...base} {...p}><circle cx="8" cy="8" r="2.1" /><path d="M8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.5 3.5 11.4 4.6M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6 3.5 3.5" /></svg>
);
export const IconMenu = (p: P) => (
  <svg {...base} {...p}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></svg>
);
export const IconClose = (p: P) => (
  <svg {...base} {...p}><path d="m4 4 8 8M12 4l-8 8" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base} {...p}><path d="m3.5 8.4 3 3 6-6.8" /></svg>
);
export const IconExternal = (p: P) => (
  <svg {...base} {...p}><path d="M9.5 2.5h4v4" /><path d="M13.5 2.5 7.8 8.2" /><path d="M12 9.4v3.3a.8.8 0 0 1-.8.8H3.3a.8.8 0 0 1-.8-.8V4.8a.8.8 0 0 1 .8-.8h3.3" /></svg>
);
export const IconPlus = (p: P) => (
  <svg {...base} {...p}><path d="M8 3.2v9.6M3.2 8h9.6" /></svg>
);
export const IconTrash = (p: P) => (
  <svg {...base} {...p}><path d="M2.8 4.4h10.4" /><path d="M6 4.4V3.2a.7.7 0 0 1 .7-.7h2.6a.7.7 0 0 1 .7.7v1.2" /><path d="M4.2 4.4l.6 8.4a.8.8 0 0 0 .8.7h4.8a.8.8 0 0 0 .8-.7l.6-8.4" /></svg>
);
export const IconArrowRight = (p: P) => (
  <svg {...base} {...p}><path d="M2.8 8h10.4" /><path d="m9.4 4.2 3.8 3.8-3.8 3.8" /></svg>
);
export const IconLogout = (p: P) => (
  <svg {...base} {...p}><path d="M6.2 2.8H3.6a.8.8 0 0 0-.8.8v8.8a.8.8 0 0 0 .8.8h2.6" /><path d="M9.6 11 12.8 8 9.6 5" /><path d="M12.6 8H6" /></svg>
);
export const IconPlay = (p: P) => (
  <svg {...base} {...p}><path d="M5.2 3.4 12 8l-6.8 4.6V3.4Z" /></svg>
);
