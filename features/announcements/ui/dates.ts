/** Every date a person types or reads is Indian time. These two cross between the form's "YYYY-MM-DDTHH:mm" and a real instant. */
export const toIstInput = (d: Date | string | null | undefined): string => (d ? new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 16) : "");
export const fromIstInput = (s: string): string | null => (s ? `${s}:00+05:30` : null);
/** "Saved 10:42" */
export const clockIst = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
