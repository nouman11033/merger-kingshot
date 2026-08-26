import type { Metadata, Viewport } from "next";
import { Figtree, Outfit } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

import "./globals.css";

const outfitHeading = Outfit({ subsets: ["latin"], variable: "--font-heading" });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Kingshot Merge Planner",
  description:
    "Collaborative roster planning for Kingshot alliance merges: pull rosters from the Kingshot Stats API and build a shared 100-player Prime roster in realtime.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1917" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans text-foreground antialiased",
          figtree.variable,
          outfitHeading.variable,
        )}
      >
        <ThemeProvider>
          <div className="fixed top-3 right-3 z-40">
            <ThemeToggle />
          </div>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
