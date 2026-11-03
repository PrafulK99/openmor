import type { Metadata } from "next";
import { Hanken_Grotesk, Vollkorn } from "next/font/google";
import "./globals.css";

// next/font downloads these at build time and serves them from our own origin, so the CSP's
// font-src 'self' still holds and the page never calls Google at runtime. Only the landing page
// uses them, through --font-display and --font-body in globals.css.
const display = Vollkorn({ subsets: ["latin"], weight: "600", variable: "--font-vollkorn", display: "swap" });
const body = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-hanken", display: "swap" });

export const metadata: Metadata = {
  title: "OpenMoR",
  description:
    "Open-source layer that lets AI agents discover, quote, buy and receive digital products from merchant-of-record sellers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
