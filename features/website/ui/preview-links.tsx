"use client";

import { useEffect } from "react";
import { withPreview } from "./preview-href";

/** In a preview of the draft or of a saved version, every link to another page of the site keeps the preview. */
export function PreviewLinks({ query }: { query: string }) {
  useEffect(() => {
    for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href^='/']")) {
      const was = a.getAttribute("href") ?? "";
      const next = withPreview(was, query);
      if (next !== was) a.setAttribute("href", next);
    }
  }, [query]);
  return null;
}
