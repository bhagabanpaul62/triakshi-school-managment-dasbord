import type { Field } from "@smw/ui/shell/FormModal";

/** Students cannot change their name: it comes from the office. */
export const detailFields = (isStudent: boolean): Field[] => [
  ...(isStudent ? [] : [{ name: "name", label: "Name", required: true, wide: true } satisfies Field]),
  { name: "email", label: "Email", type: "email", wide: true, hint: "A new address only applies after you enter the code, or open the link, we send to it." },
  { name: "currentPassword", label: "Current password", type: "password", wide: true, hint: "Only needed when you change your email." },
  { name: "phone", label: "Mobile", type: "tel", wide: true },
];

export const photoFields: Field[] = [
  { name: "photo", label: "Photo", type: "file", required: true, accept: "image/png,image/jpeg,image/webp", hint: "PNG, JPG or WebP, up to 5 MB. A square photo works best.", wide: true, asJpeg: true },
];

export const passwordFields: Field[] = [
  { name: "current", label: "Current password", type: "password", required: true, wide: true },
  { name: "next", label: "New password", type: "password", required: true, wide: true, hint: "At least 8 characters. Not your login ID, date of birth or a common password." },
  { name: "confirm", label: "New password again", type: "password", required: true, wide: true },
];
