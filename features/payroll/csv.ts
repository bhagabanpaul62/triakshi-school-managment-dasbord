/** One CSV text: every cell quoted when needed, and a leading "=" or "+" is neutralised so a spreadsheet never runs it. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v == null ? "" : String(v);
    if (/^[=+@]/.test(s) || (/^-/.test(s) && typeof v === "string" && !/^-\d+(\.\d+)?$/.test(s))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}
export const rupeeText = (paise: number) => (paise / 100).toFixed(2);
export const monthLabel = (month: string) => new Date(`${month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
