import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BD Desk — Pipeline",
  description: "BD targets sourced by the Opportunity Radar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
