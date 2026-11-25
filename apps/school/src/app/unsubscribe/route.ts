import { getSchool } from "@smw/runtime";
import { escapeHtml } from "@smw/integrations";
import { PreferenceService } from "@smw/feature-notifications/prefs";
import { TOPIC_GROUPS, type TopicGroup } from "@smw/feature-notifications/topics";
import { ValidationError } from "@smw/feature-kit";

export const dynamic = "force-dynamic";

// One address does both jobs. GET only asks (mail scanners open links, so a GET never changes anything);
// POST does it, whether it comes from the button here or from a mail app's one-click unsubscribe (RFC 8058).
const page = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>` +
  `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:12vh auto;padding:0 20px;color:#111;line-height:1.5"><h1 style="font-weight:600;font-size:22px">${escapeHtml(title)}</h1>${body}</body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });

const read = (req: Request) => {
  const q = new URL(req.url).searchParams, g = q.get("g");
  return { token: (q.get("t") ?? "").slice(0, 200), group: g && g in TOPIC_GROUPS ? (g as TopicGroup) : undefined, bad: !!g && !(g in TOPIC_GROUPS) };
};
const btn = "background:#111;color:#fff;border:0;padding:12px 20px;border-radius:999px;font-size:16px;cursor:pointer";

export async function GET(req: Request) {
  const school = await getSchool();
  const { token, group, bad } = read(req);
  if (!token || bad) return page("This link does not work", `<p>It may be too old or cut short. Open the email again and use the link at the bottom, or ask the school office.</p>`, 400);
  const what = group ? `emails about ${TOPIC_GROUPS[group].toLowerCase()}` : "emails that you are allowed to turn off";
  return page(`Stop ${escapeHtml(what)}?`, `<p>${escapeHtml(school.name)} will stop sending you ${escapeHtml(what)}. You will still see everything in the app, and urgent safety and account emails still reach you.</p>` +
    `<form method="post"><button type="submit" style="${btn}">Stop these emails</button></form><p style="color:#666;font-size:14px">You can turn them back on any time in your notification settings.</p>`);
}

export async function POST(req: Request) {
  const school = await getSchool();
  const { token, group, bad } = read(req);
  if (!token || bad) return page("This link does not work", `<p>It may be too old or cut short. Ask the school office for help.</p>`, 400);
  try {
    const hit = await PreferenceService.unsubscribeByToken(school.id, token, group);
    if (!hit) return page("This link does not work", `<p>It may be too old. Ask the school office for help.</p>`, 400);
  } catch (e) {
    if (e instanceof ValidationError) return page("These emails cannot be stopped", `<p>${escapeHtml(Object.values(e.fieldErrors ?? {})[0] ?? "They are always sent.")}</p>`, 400);
    throw e;
  }
  return page("Done", `<p>${escapeHtml(school.name)} will not send you these emails any more. You can turn them back on in your notification settings.</p>`);
}
