/**
 * One rule for a phone number typed on the public forms and by the office (the browser and the server both use it).
 * Accepts +91, 91 and 0 prefixes, spaces, dashes and brackets. Returns a 10 digit mobile, or a landline with its area code
 * (10 or 11 digits, the 0 kept), or null. An 11 digit number with a 0 and a 6 to 9 after it is a mobile with the 0 dialled,
 * except the area codes 079 and 080.
 */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0091")) d = d.slice(4);
  else if (d.length >= 12 && d.startsWith("91")) d = d.slice(2);
  if (/^0[6-9]\d{9}$/.test(d) && !/^0(79|80)/.test(d)) d = d.slice(1);
  if (/^[6-9]\d{9}$/.test(d)) return d;
  if (/^0[1-9]\d{8,9}$/.test(d)) return d;
  return null;
}
