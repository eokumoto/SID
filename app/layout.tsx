import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SID",
  description: "A simple space to read text at your own pace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
