import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenMoR",
  description:
    "Open-source layer that lets AI agents discover, quote, buy and receive digital products from merchant-of-record sellers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
