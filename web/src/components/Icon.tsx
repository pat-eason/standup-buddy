import type { ReactNode, SVGProps } from 'react';

const paths: Record<string, ReactNode> = {
  today: <><rect x="3.5" y="5" width="17" height="15" rx="3.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3.5 4.5v4h4M12 7.5V12l3 2" /></>,
  insights: <><path d="M4.5 20V10M10 20V4.5M15.5 20v-7M21 20H3" /></>,
  'trend-up': <path d="M4 16l5.5-5.5 3.5 3.5L20 7M15 7h5v5" />,
  'trend-down': <path d="M4 8l5.5 5.5 3.5-3.5L20 17M15 17h5v-5" />,
  'trend-flat': <path d="M4 12h16M16 8l4 4-4 4" />,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  sparkle: <><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" /><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></>,
  send: <path d="M4 12l16-8-6 16-2.5-6.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7" /></>,
  edit: <><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M14.5 7.5l3 3" /></>,
  note: <><path d="M5 4.5h14v11l-4.5 4.5H5z" /><path d="M14.5 20v-4.5H19M8.5 9h7M8.5 12.5h4" /></>,
  left: <path d="M14.5 5.5L8 12l6.5 6.5" />,
  right: <path d="M9.5 5.5L16 12l-6.5 6.5" />,
  update: <><path d="M5 17l5-5 3.5 3.5L20 8" /><path d="M15 8h5v5" /></>,
  question: <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 16.8v.1" /></>,
  decision: <><path d="M12 3.5v6M12 9.5L6 14v6.5M12 9.5l6 4.5v6.5" /><circle cx="12" cy="3.5" r="1.2" /></>,
  parking: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M10 16.5v-9h3a2.8 2.8 0 0 1 0 5.6h-3" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>,
  loader: <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />,
  stream: <><path d="M4 7h16M4 12h11M4 17h7" /></>,
  flag: <><path d="M5.5 20.5v-16M5.5 5h11l-2 3.5 2 3.5h-11" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" /><path d="M19.5 4.5v4.2h-4.2" /></>,
  tool: <path d="M14.5 6.5a4 4 0 0 0 4.8 4.8l-8.8 8.8a2 2 0 0 1-2.8-2.8l8.8-8.8a4 4 0 0 1-2-2z" />,
  sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="3.5" /><path d="M9.5 4.5v15" /></>,
  why: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1V16h5v-.1c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></>,
  external: <><path d="M14 4.5h5.5V10M19.5 4.5L11 13" /><path d="M18 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10" /></>,
};

export type IconName = keyof typeof paths | string;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {paths[name] ?? null}
    </svg>
  );
}
