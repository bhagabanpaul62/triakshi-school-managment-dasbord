import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@smw/ui/shell/toast";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "School", template: "%s" }, description: "School website and management panel",
  manifest: "/manifest.webmanifest", icons: { apple: "/api/push/icon" },
};
// The school's own colour is in its manifest; this is the bar colour before that loads.
export const viewport: Viewport = { themeColor: "#0f172a" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <body className={inter.className}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
