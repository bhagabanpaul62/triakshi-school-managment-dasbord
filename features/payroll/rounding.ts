// How each contribution is rounded, as dated rates so a school can override them and the review names the source.
// Checked 2026-11-24 against secondary sources only; the EPFO and ESIC circulars were not read. Medium confidence.
import type { Rate } from "./rates";

const EPFO = "https://www.epfindia.gov.in/";
const ESIC = "https://esic.gov.in/";
const row = (key: string, value: "paise" | "nearest" | "up", source: string, note: string): Rate<string> => ({ key, from: "2014-09-01", value, source, confidence: "medium", note });

export const ROUNDING_RATES: Rate<string>[] = [
  row("round_pf_employee", "nearest", EPFO, "Employee PF, to the nearest rupee for each person each month."),
  row("round_pf_employer", "nearest", EPFO, "Employer total, to the nearest rupee; the employer PF is that total less the pension share."),
  row("round_eps", "nearest", EPFO, "Pension share, rounded first, to the nearest rupee."),
  row("round_esi_employee", "up", ESIC, "Employee ESI, up to the next whole rupee for each person each month."),
  row("round_esi_employer", "up", ESIC, "Employer ESI, up to the next whole rupee for each person each month."),
];
