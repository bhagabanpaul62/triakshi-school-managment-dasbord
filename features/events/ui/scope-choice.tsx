"use client";

import { SCOPES, type Scope } from "../constants";

/** Which dates of a series a change reaches. Only shown for an event that belongs to a series. */
export function ScopeChoice({ value, onChange, name = "scope" }: { value: Scope; onChange: (s: Scope) => void; name?: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Which events</legend>
      {(Object.keys(SCOPES) as Scope[]).map((k) => (
        <label key={k} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl bg-white/[0.05] px-4 text-sm has-[:checked]:bg-[var(--ds-color-primary-500)]/20">
          <input type="radio" name={name} value={k} checked={value === k} onChange={() => onChange(k)} className="h-4 w-4 accent-[var(--ds-primary)]" />
          {SCOPES[k]}
        </label>
      ))}
    </fieldset>
  );
}
