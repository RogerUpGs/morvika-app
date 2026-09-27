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
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  doc: 'M6 3h8l4 4v14H6V3Zm8 0v4h4M9 12h6M9 16h6',
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
