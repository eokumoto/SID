import type { CSSProperties } from "react";

export type IconName =
  | "upload"
  | "document"
  | "settings"
  | "history"
  | "photo"
  | "speaker"
  | "stop"
  | "trash"
  | "retry"
  | "close"
  | "eye"
  | "blur"
  | "offline"
  | "check"
  | "minus"
  | "plus"
  | "logout"
  | "mail"
  | "book";
const paths: Record<IconName, React.ReactNode> = {
  document: (
    <>
      <path d="M5 3h10l4 4v14H5zM15 3v4h4M8 10h7M8 14h5M8 18h7" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
    </>
  ),
  settings: (
    <>
      <path d="M9 3h6v3h2l2-2 2 2-2 2v2h3v4h-3v2l2 2-2 2-2-2h-2v3H9v-3H7l-2 2-2-2 2-2v-2H2v-4h3V8L3 6l2-2 2 2h2z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-8 8" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 10h4l5-4v12l-5-4H4zM17 9a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  trash: <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7m4-7v7" />,
  retry: <path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  blur: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="m8 15 3-3 2 2 3-4M4 4l16 16" />
    </>
  ),
  offline: (
    <>
      <path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0M3 3l18 18" />
      <circle cx="12" cy="20" r=".5" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M5 12h14M12 5v14" />,
  logout: (
    <>
      <path d="M9 4H4v16h5m6-12 4 4-4 4M9 12h10" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="m3 6 9 7 9-7" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22z" />
    </>
  ),
};
export function Icon({
  name,
  className = "",
  style,
}: {
  name: IconName;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
