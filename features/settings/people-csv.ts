/** Rows to CSV text: quotes where needed, and a leading = + - @ is defused so a spreadsheet never runs a cell as a formula. */
export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\uFEFF${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}
