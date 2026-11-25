// Words and India time shared by every module and screen. Pure (no framework, no Node), so services, jobs and client components all use it.
type DateLike = Date | string | number | null | undefined;
const IST = "Asia/Kolkata";
// Every date a person types or reads is IST; these cross between instants, IST days and form values.
const IST_MS = 330 * 60_000;
const istIso = (d: DateLike) => new Date(new Date(d as Date | string | number).getTime() + IST_MS).toISOString();

/** The IST calendar day of an instant: "2026-12-06". */
export const istDay = (d: Date | string | number) => istIso(d).slice(0, 10);
/** The IST time of day of an instant, 24 hour: "10:30". */
export const istHm = (d: Date | string | number) => istIso(d).slice(11, 16);
/** "10:30 am". */
export const clock = (d: Date | string | number) => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST });
/** An instant as the value of an `<input type="datetime-local">` ("2026-12-05T10:30"), in IST. Empty for none. */
export const toIstInput = (d: DateLike): string => (d ? istIso(d).slice(0, 16) : "");
/** A form value back to an instant with its zone. Null for empty. */
export const fromIstInput = (s: string): string | null => (s ? `${s}:00+05:30` : null);
/** A form's "2026-12-05T10:30" is India wall-clock time; anything with a zone is taken as is. */
export function parseIstInput(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  const zoned = /T/.test(s) && /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const d = new Date(zoned ? s : `${s}${/T\d{2}:\d{2}$/.test(s) ? ":00" : ""}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "1 family", "3 families". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
