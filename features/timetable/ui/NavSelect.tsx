"use client";

import { useRouter } from "next/navigation";
import { INPUT } from "@smw/ui/shell/FormModal";

/** A picker that navigates: each option is a link target, so the choice lives in the URL and the server page re-renders. */
export function NavSelect({ label, value, options, placeholder }: {
  label: string;
  /** The href of the selected option; empty shows the placeholder. */
  value: string;
  options: { href: string; label: string }[];
  placeholder?: string;
}) {
  const router = useRouter();
  return (
    <label className="block min-w-[10rem]">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => router.push(e.target.value)} className={`${INPUT} rounded-full`}>
        {placeholder ? <option value="" disabled>{placeholder}</option> : null}
        {options.map((o) => <option key={o.href} value={o.href}>{o.label}</option>)}
      </select>
    </label>
  );
}
