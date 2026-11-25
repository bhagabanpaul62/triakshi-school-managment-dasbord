"use client";

import { useState, type FormEvent } from "react";
import { unshown, type Failure } from "../form-errors";

/**
 * Server errors of one form: per field, plus one sentence for anything no field shows (the daily limit, a closed conversation, an unknown field).
 * An error clears when its field changes. `name` maps an input name to its error key (the ask form's `v_x` is `values.x`).
 */
export function useFormErrors(shown: readonly string[], key: (inputName: string) => string = (n) => n) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lost, setLost] = useState<{ text: string; keys: string[] } | null>(null);
  const clear = (k: string) => {
    setErrors((e) => { if (!(k in e)) return e; const { [k]: _gone, ...rest } = e; return rest; });
    setLost((l) => (l && l.keys.includes(k) ? null : l));
  };
  return {
    errors,
    fail: (r: Failure) => { setErrors(r.fieldErrors ?? {}); setLost(unshown(r, shown)); },
    reset: () => { setErrors({}); setLost(null); },
    clear,
    /** Put on the `<form>`. */
    onChange: (e: FormEvent<HTMLFormElement>) => { const n = (e.target as HTMLInputElement).name; if (n) clear(key(n)); },
    note: lost ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{lost.text}</p> : null,
  };
}
