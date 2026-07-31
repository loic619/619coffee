import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import TabNav from "@/components/TabNav";
import MarketTicker from "@/components/map/MarketTicker";
import DataFetchGuard from "@/components/DataFetchGuard";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Coffee Intel Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full flex flex-col bg-gray-950`}>
        {/* Global retry + last-known-good fallback for /data/*.json fetches. */}
        <DataFetchGuard />
        <TabNav />
        <MarketTicker />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </body>
    </html>
  );
}
