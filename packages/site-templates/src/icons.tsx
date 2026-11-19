import type { ReactNode } from "react";

/** Line icons (Feather, MIT). A highlight's icon is picked from the words in its title, so schools never choose one. */
const ICONS: [RegExp, ReactNode][] = [
  [/librar|book|read|story|curricul|academ|primary|secondary|middle|class/i, <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>],
  [/safe|secur|cctv|guard|protect/i, <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />],
  [/sport|game|play|athlet|yoga|fitness/i, <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />],
  [/bus|transport|van|pick/i, <><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>],
  [/smart|computer|digital|online|tech|coding/i, <><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></>],
  [/lab|science|experiment|stem/i, <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />],
  [/music|dance|art|craft|drama|cultur/i, <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>],
  [/teacher|staff|faculty|small|parent|famil|club|team/i, <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>],
  [/result|award|topper|achiev|competition|mission|excel/i, <><circle cx="12" cy="8" r="7" /><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" /></>],
  [/value|care|kind|health|medical|well|pre-primary|nursery/i, <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />],
  [/language|global|world|international|vision/i, <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>],
  [/meal|canteen|lunch|food/i, <><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /></>],
  [/hostel|boarding|campus|building|office/i, <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>],
  [/pay|fee|upi|due|date/i, <><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></>],
];
const FALLBACK = <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>;

export function TopicIcon({ title }: { title: string }) {
  const shape = ICONS.find(([re]) => re.test(title))?.[1] ?? FALLBACK;
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{shape}</svg>;
}
