"use client";

import { useEffect, useState, type MouseEvent } from "react";
import type { Theme } from "@smw/themes";
import { HOME_SLUG, type SiteContent, type SiteSettings, type TemplateKey } from "@smw/site-templates";
import { SiteView, type SiteData } from "@smw/site-templates/render";

export interface LiveState { content: SiteContent; slug: string; template: TemplateKey; focus?: string }
/** Messages between the editor (parent window) and this frame. Same origin only. */
export type FrameMessage = { smw: "ready" } | { smw: "nav"; slug: string } | { smw: "select"; id: string } | ({ smw: "site" } & LiveState);

const say = (m: FrameMessage) => window.parent.postMessage(m, window.location.origin);
const previewOnly = async () => ({ ok: false as const, error: "This is a preview. The form works on your live site." });

/**
 * The draft site inside the editor's preview frame. The editor posts the content as it is typed, so nothing is
 * saved to show a change. A click on a link changes the page in the editor; a click on a section opens it there.
 */
export function LivePreview({ school, theme, data, initial, settings }: { school: { name: string; logoUrl?: string | null }; theme: Theme; data: SiteData; initial: LiveState; settings?: SiteSettings }) {
  const [s, setS] = useState(initial);

  useEffect(() => {
    const on = (e: MessageEvent<FrameMessage>) => {
      if (e.origin !== window.location.origin || e.data?.smw !== "site") return;
      const { content, slug, template, focus } = e.data;
      setS({ content, slug, template, focus });
    };
    window.addEventListener("message", on);
    say({ smw: "ready" });
    return () => window.removeEventListener("message", on);
  }, []);

  useEffect(() => {
    if (s.focus) document.getElementById(s.focus)?.scrollIntoView({ block: "center", behavior: "smooth" });
    else window.scrollTo({ top: 0 });
  }, [s.focus, s.slug]);

  const click = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    const a = el.closest("a");
    if (a) {
      e.preventDefault();
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("/")) say({ smw: "nav", slug: href.slice(1).split(/[?#]/)[0] || HOME_SLUG });
      return;
    }
    const sec = el.closest("main section[id]");
    if (sec) say({ smw: "select", id: sec.id });
  };

  return (
    <div onClickCapture={click}>
      <style>{`main section[id]{cursor:pointer}main section[id]:hover{outline:2px dashed color-mix(in srgb,var(--site-accent) 70%,transparent);outline-offset:-2px}${s.focus ? `[id=${JSON.stringify(s.focus)}]{outline:3px solid var(--site-accent)!important;outline-offset:-3px}` : ""}`}</style>
      <SiteView school={school} template={s.template} theme={theme} content={s.content} slug={s.slug} data={data} enquiry={previewOnly} settings={settings} />
    </div>
  );
}
