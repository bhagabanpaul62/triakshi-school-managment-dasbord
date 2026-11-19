import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import { env } from "@smw/config";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const interTight = Inter_Tight({ subsets: ["latin"], display: "swap", weight: ["600", "700", "800"], variable: "--font-inter-tight" });

const description = "School management for Indian schools: attendance, fees, exams, timetable and parent communication on one dashboard. 30-day free trial.";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(env().MARKETING_URL),
    title: { default: "Triakshi: run your school on one dashboard", template: "%s · Triakshi" },
    description,
    openGraph: { title: "Triakshi: run your school on one dashboard", description, type: "website", locale: "en_IN", siteName: "Triakshi" },
    robots: { index: true, follow: true },
  };
}
export const viewport: Viewport = { themeColor: "#f5f6f2", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${interTight.variable}`}>
      <body className="font-sans">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-ink">Skip to content</a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
