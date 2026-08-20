/**
 * Icon set.
 *
 * Hand-drawn 16px strokes on a shared grid rather than an icon dependency: a nav needs a dozen
 * glyphs, and shipping a whole library for that costs more than it is worth.
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
export const IconLayers = (p: P) => (
  <svg {...base} {...p}><path d="M8 2 14 5.2 8 8.4 2 5.2 8 2Z" /><path d="M2 8.6 8 11.8l6-3.2" /><path d="M2 11.6 8 14.8l6-3.2" /></svg>
);
export const IconTarget = (p: P) => (
  <svg {...base} {...p}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" /></svg>
);
export const IconBuilding = (p: P) => (
  <svg {...base} {...p}><path d="M2.5 13.5V3.2a.7.7 0 0 1 .7-.7h5.6a.7.7 0 0 1 .7.7v10.3" /><path d="M9.5 6.5h3.3a.7.7 0 0 1 .7.7v6.3" /><path d="M1.5 13.5h13" /><path d="M4.8 5.5h2M4.8 8h2M4.8 10.5h2M11 9h1M11 11.3h1" /></svg>
);
export const IconUsers = (p: P) => (
  <svg {...base} {...p}><circle cx="6" cy="5.5" r="2.4" /><path d="M1.8 13.4a4.4 4.4 0 0 1 8.4 0" /><path d="M10.6 3.4a2.4 2.4 0 0 1 0 4.4" /><path d="M11.6 9.6a4.4 4.4 0 0 1 2.7 3.8" /></svg>
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
export const IconShield = (p: P) => (
  <svg {...base} {...p}><path d="M8 1.8 13.2 4v4c0 3.2-2.3 5.4-5.2 6.2C5.1 13.4 2.8 11.2 2.8 8V4L8 1.8Z" /><path d="m5.9 8 1.5 1.5 2.8-2.9" /></svg>
);
export const IconHistory = (p: P) => (
  <svg {...base} {...p}><path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8" /><path d="M2.2 2.6v2.9h2.9" /><path d="M8 5.2V8l1.9 1.2" /></svg>
);
export const IconPlug = (p: P) => (
  <svg {...base} {...p}><path d="M6 2v3.2M10 2v3.2" /><path d="M4.2 5.4h7.6v2.4a3.8 3.8 0 0 1-7.6 0V5.4Z" /><path d="M8 11.6V14" /></svg>
);
export const IconChevron = (p: P) => (
  <svg {...base} {...p}><path d="m6 3.5 4 4.5-4 4.5" /></svg>
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
export const IconFilter = (p: P) => (
  <svg {...base} {...p}><path d="M2.5 3.8h11L9.4 8.6v4L6.6 14V8.6L2.5 3.8Z" /></svg>
);
export const IconPlus = (p: P) => (
  <svg {...base} {...p}><path d="M8 3.2v9.6M3.2 8h9.6" /></svg>
);
export const IconTrash = (p: P) => (
  <svg {...base} {...p}><path d="M2.8 4.4h10.4" /><path d="M6 4.4V3.2a.7.7 0 0 1 .7-.7h2.6a.7.7 0 0 1 .7.7v1.2" /><path d="M4.2 4.4l.6 8.4a.8.8 0 0 0 .8.7h4.8a.8.8 0 0 0 .8-.7l.6-8.4" /></svg>
);
export const IconEye = (p: P) => (
  <svg {...base} {...p}><path d="M1.6 8S3.9 3.8 8 3.8 14.4 8 14.4 8 12.1 12.2 8 12.2 1.6 8 1.6 8Z" /><circle cx="8" cy="8" r="1.9" /></svg>
);
export const IconMail = (p: P) => (
  <svg {...base} {...p}><rect x="2" y="3.6" width="12" height="8.8" rx="1" /><path d="m2.4 4.4 5.6 4 5.6-4" /></svg>
);
export const IconArrowRight = (p: P) => (
  <svg {...base} {...p}><path d="M2.8 8h10.4" /><path d="m9.4 4.2 3.8 3.8-3.8 3.8" /></svg>
);
export const IconClock = (p: P) => (
  <svg {...base} {...p}><circle cx="8" cy="8" r="5.8" /><path d="M8 4.6V8l2.3 1.6" /></svg>
);
export const IconLink = (p: P) => (
  <svg {...base} {...p}><path d="M6.6 9.4a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.9.9" /><path d="M9.4 6.6a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.9-.9" /></svg>
);
export const IconAlert = (p: P) => (
  <svg {...base} {...p}><path d="M8 2.6 14.4 13.4H1.6L8 2.6Z" /><path d="M8 6.6v3" /><path d="M8 11.6h.01" /></svg>
);
export const IconInfo = (p: P) => (
  <svg {...base} {...p}><circle cx="8" cy="8" r="5.8" /><path d="M8 7.4v3.4" /><path d="M8 5.2h.01" /></svg>
);
export const IconColumns = (p: P) => (
  <svg {...base} {...p}><rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1" /><path d="M6.2 2.8v10.4M9.8 2.8v10.4" /></svg>
);
export const IconSort = (p: P) => (
  <svg {...base} {...p}><path d="M4.4 3v10" /><path d="m2.2 10.8 2.2 2.2 2.2-2.2" /><path d="M9 4.4h5" /><path d="M9 8h3.6" /><path d="M9 11.6h2.2" /></svg>
);
export const IconGlobe = (p: P) => (
  <svg {...base} {...p}><circle cx="8" cy="8" r="5.8" /><path d="M2.4 8h11.2" /><path d="M8 2.2a10 10 0 0 1 0 11.6a10 10 0 0 1 0-11.6Z" /></svg>
);
export const IconLogout = (p: P) => (
  <svg {...base} {...p}><path d="M6.2 2.8H3.6a.8.8 0 0 0-.8.8v8.8a.8.8 0 0 0 .8.8h2.6" /><path d="M9.6 11 12.8 8 9.6 5" /><path d="M12.6 8H6" /></svg>
);
export const IconPlay = (p: P) => (
  <svg {...base} {...p}><path d="M5.2 3.4 12 8l-6.8 4.6V3.4Z" /></svg>
);
export const IconStop = (p: P) => (
  <svg {...base} {...p}><rect x="4" y="4" width="8" height="8" rx="1" /></svg>
);
export const IconDatabase = (p: P) => (
  <svg {...base} {...p}><ellipse cx="8" cy="4" rx="5.2" ry="2" /><path d="M2.8 4v8c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2V4" /><path d="M2.8 8c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2" /></svg>
);
