import type { ImgHTMLAttributes } from "react";

// Blob previews and short-lived signed photo URLs stay outside Next's image proxy.
export function ScanImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={props.alt ?? ""} />;
}
