"use client";

import * as React from "react";
import { IconAlertTriangle, IconHelp, IconLoader2 } from "@tabler/icons-react";

import { cn } from "../../lib/utils";
import { buttonVariants } from "./button";
import { IconChip } from "../dashboard/kit/Panel";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
};

// Why: wrap radix AlertDialog so all confirm flows inherit role="alertdialog"
// + Esc handling without each consumer rewiring a11y.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  isLoading: isLoadingProp,
  onConfirm,
}: ConfirmDialogProps) {
  const [internalLoading, setInternalLoading] = React.useState(false);
  const confirmRef = React.useRef<HTMLButtonElement | null>(null);

  // External isLoading wins so parents can drive state from a mutation hook;
  // otherwise we track the promise lifecycle ourselves.
  const loading = isLoadingProp ?? internalLoading;

  React.useEffect(() => {
    if (!open) return;
    // Radix focuses the cancel button by default in AlertDialog; we want confirm
    // focused so keyboard-first flows can press Enter to proceed.
    const id = requestAnimationFrame(() => {
      confirmRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const handleConfirm = async () => {
    if (loading) return;
    try {
      const result = onConfirm();
      if (result instanceof Promise) {
        setInternalLoading(true);
        await result;
        onOpenChange(false);
      }
    } finally {
      setInternalLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    // Block close attempts while a confirm promise is in flight so users
    // can't dismiss a half-finished destructive action.
    if (loading && !next) return;
    onOpenChange(next);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader className="flex-row items-start gap-4 space-y-0 text-left">
          <IconChip
            className={cn(
              "h-10 w-10",
              destructive && "bg-[var(--ds-color-danger-500)]/15 text-[var(--ds-color-danger-400)]",
            )}
          >
            {destructive ? <IconAlertTriangle className="h-5 w-5" strokeWidth={1.8} /> : <IconHelp className="h-5 w-5" strokeWidth={1.8} />}
          </IconChip>
          <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
            <AlertDialogTitle className="text-base font-semibold leading-snug">{title}</AlertDialogTitle>
            {description ? (
              <AlertDialogDescription asChild>
                <div className="text-sm leading-relaxed text-[var(--ds-on-surface-variant)]">{description}</div>
              </AlertDialogDescription>
            ) : null}
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <button
            type="button"
            disabled={loading}
            onClick={() => onOpenChange(false)}
            className={cn(
              buttonVariants({ variant: "secondary" }),
              "mt-2 rounded-xl sm:mt-0",
            )}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={loading}
            onClick={handleConfirm}
            className={cn(
              buttonVariants({
                variant: destructive ? "destructive" : "default",
              }),
              "rounded-xl",
              destructive &&
                "bg-[var(--ds-color-danger-500)]/15 text-[var(--ds-color-danger-400)] hover:bg-[var(--ds-color-danger-500)]/25",
            )}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <IconLoader2 className="h-4 w-4 animate-spin" />
                <span>{confirmLabel}</span>
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Imperative API: useConfirm()
// ---------------------------------------------------------------------------

type ConfirmOptions = Omit<ConfirmDialogProps, "open" | "onOpenChange">;

type PendingConfirm = {
  id: number;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};

type ConfirmContextValue = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null);

// Why: a singleton provider mirrors how <Toaster /> is mounted once at the
// root; this keeps imperative confirms colocated with the React tree so portal
// rendering, theming, and SSR all behave like the rest of the app.
export function ConfirmDialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);
  const idRef = React.useRef(0);

  const confirm = React.useCallback<ConfirmContextValue>((options) => {
    return new Promise<boolean>((resolve) => {
      idRef.current += 1;
      setPending({ id: idRef.current, options, resolve });
    });
  }, []);

  const handleConfirm = async () => {
    if (!pending) return;
    // Forward through to the caller's onConfirm so loading-on-promise still
    // applies, then resolve the outer promise with `true`.
    await pending.options.onConfirm();
    pending.resolve(true);
    setPending(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (next || !pending) return;
    pending.resolve(false);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? (
        <ConfirmDialog
          key={pending.id}
          {...pending.options}
          open
          onOpenChange={handleOpenChange}
          onConfirm={handleConfirm}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) {
    throw new Error(
      "useConfirm must be used within <ConfirmDialogProvider>. Mount it once in app/layout.tsx.",
    );
  }
  return ctx;
}
