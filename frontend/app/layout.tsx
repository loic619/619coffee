import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import TabNav from "@/components/TabNav";
import MarketTicker from "@/components/map/MarketTicker";
import DataFetchGuard from "@/components/DataFetchGuard";
import CommandPalette from "@/components/CommandPalette";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: PRODUCT_TAGLINE,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full flex flex-col bg-gray-950`}>
        {/* Global retry + last-known-good fallback for /data/*.json fetches. */}
        <DataFetchGuard />
        {/* ⌘K / Ctrl-K — go anywhere by typing. */}
        <CommandPalette />
        <TabNav />
        <MarketTicker />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </body>
    </html>
  );
}
