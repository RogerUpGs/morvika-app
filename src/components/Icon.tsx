const PATHS = {
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2V5Zm13 4h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5M8 16h3',
  msg: 'M4 6h16v10H9l-5 4V6Z',
  chat: 'M8 10h8M8 14h5M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12Z',
  cal: 'M5 6h14v14H5zM5 10h14M9 3v4M15 3v4',
  home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z',
  info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z',
  admin: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Zm-3 9 2 2 4-4',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12 20 4l-6 16-3-7-7-1Z',
  back: 'M15 5l-7 7 7 7',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Zm4 4h4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  out: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  sun: 'M12 3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m0-12.8L7 7m10 10 1.4 1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  thumb: 'M7 11v9H4v-9h3Zm0 0 4-7a2 2 0 0 1 3 2l-1 4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12l5 5 9-10',
  chev: 'M9 5l7 7-7 7',
  folder: 'M3 6h6l2 2h10v11H3V6Z',
  photo: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm0 13a3 3 0 0 1 3-3h11M9 8h6',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v4h16v-4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  doc: 'M6 3h8l4 4v14H6V3Zm8 0v4h4M9 12h6M9 16h6',
  todo: 'M10 6h10M10 12h10M10 18h10M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 20a6 6 0 0 0-3-5.2',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" aria-hidden="true">
      <path d="M5 17 12 9l5 5 4-4 8 7" />
      <path d="M4 23c3-2 5-2 7.5 0s5 2 7.5 0 5-2 7.5 0" />
      <path d="M4 28c3-2 5-2 7.5 0s5 2 7.5 0 5-2 7.5 0" opacity=".5" />
    </svg>
  );
}
