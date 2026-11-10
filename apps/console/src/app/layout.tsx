import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Platform console",
};

/**
 * Root layout for the Platform console app.
 * @param props.children The page being rendered.
 * @returns The html and body wrapper.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
