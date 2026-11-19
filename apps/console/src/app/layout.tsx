import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@smw/ui/shell/toast";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = { title: { default: "Triakshi Console", template: "%s · Console" }, description: "Platform console", robots: { index: false } };

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
