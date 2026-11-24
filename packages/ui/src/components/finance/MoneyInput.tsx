"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "../../lib/utils";
import { INPUT } from "../../shell/FormModal";
import { cleanAmount, formatPaise, fromPaise, groupIndian, toPaise } from "./logic";

export interface MoneyInputProps {
  /** Field name. The form posts the integer paise under it; the visible box has no name. */
  name?: string;
  label: string;
  /** Hide the label visually (rows in a table); screen readers still hear it. */
  labelHidden?: boolean;
  /** Current amount in paise. Pass it to control the field; omit it for an uncontrolled one. */
  valuePaise?: number | null;
  /** Fires with integer paise, or null while the box is empty. */
  onChange?: (paise: number | null) => void;
  error?: string;
  hint?: string;
  /** Largest allowed amount in paise; the box shows the error, the server still checks. */
  max?: number;
  required?: boolean;
  disabled?: boolean;
  /** Turns paise into words ("Twelve hundred rupees only"); pass inWords from @smw/feature-kit/money. Shown under the box. */
  words?: (paise: number) => string;
  className?: string;
}

/** Rupees in, paise out. Takes "1,200", "1200.5" or "₹1,200"; refuses a third decimal. */
export function MoneyInput({ name, label, labelHidden, valuePaise, onChange, error, hint, max, required, disabled, words, className }: MoneyInputProps) {
  const id = useId();
  const [text, setText] = useState(valuePaise == null ? "" : fromPaise(valuePaise));
  const [focused, setFocused] = useState(false);
  const paise = toPaise(text);

  // A parent that changes the value (reset, duplicate row) wins over what was typed.
  useEffect(() => {
    if (valuePaise !== undefined && valuePaise !== paise) setText(valuePaise == null ? "" : fromPaise(valuePaise));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuePaise]);

  const tooBig = max !== undefined && paise !== null && paise > max;
  const shownError = error ?? (tooBig ? `Cannot be more than ${formatPaise(max!)}.` : undefined);
  const below = id + "-below";
  const hasBelow = Boolean(shownError || hint || (words && paise));

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cn("text-[13px] font-medium text-[var(--ds-on-surface-variant)]", labelHidden && "sr-only")}>
        {label}
        {required ? <span className="ml-0.5 text-[var(--ds-color-danger-400)]" aria-hidden> *</span> : null}
      </label>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--ds-on-surface-muted)]">₹</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={focused || paise === null ? text : groupIndian(fromPaise(paise))}
          disabled={disabled}
          required={required}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={hasBelow ? below : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (paise !== null) setText(fromPaise(paise)); }}
          onChange={(e) => {
            const c = cleanAmount(e.target.value);
            if (c === null) return;
            setText(c);
            onChange?.(toPaise(c));
          }}
          className={cn(INPUT, "pl-7 text-right tabular-nums")}
        />
      </div>
      {name ? <input type="hidden" name={name} value={paise === null ? "" : String(paise)} /> : null}
      {hasBelow ? (
        <div id={below} className="flex flex-col gap-1">
          {shownError ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{shownError}</p> : null}
          {words && paise ? <p className="text-xs text-[var(--ds-on-surface-muted)]">{words(paise)}</p> : null}
          {hint && !shownError ? <p className="text-xs text-[var(--ds-on-surface-muted)]">{hint}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
