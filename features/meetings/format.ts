// India-time words for screens, notices and sheets. No imports, so client components can use it.
const TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
const DAY = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
const DAY_LONG = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });

/** "10:30 am". */
export const clock = (d: Date) => TIME.format(new Date(d));
/** "Fri, 5 Dec". */
export const dayOf = (d: Date) => DAY.format(new Date(d));
export const dayLong = (d: Date) => DAY_LONG.format(new Date(d));
/** "Fri, 5 Dec, 10:30 am". */
export const when = (d: Date) => `${DAY.format(new Date(d))}, ${TIME.format(new Date(d))}`;
