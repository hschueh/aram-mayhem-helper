import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARAM: 大亂鬥 Helper",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
