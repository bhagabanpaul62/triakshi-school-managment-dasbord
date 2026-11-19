"use client";

import type { ReactNode } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, type DialogSize } from "../../ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../../ui/sheet";
import { Button } from "../../ui/button";
import { IconChip } from "./Panel";
import { cn } from "../../../lib/utils";

/**
 * The one way to build a modal or side panel. Pick the size from the job, not from habit:
 *  - sm  (400)  a confirmation or a single question
 *  - md  (520)  one short form (up to ~6 fields)
 *  - lg  (720)  a longer form, or a list with a preview
 *  - xl  (960)  a two-pane picker / builder (`aside` = the running summary or selection)
 *  - 2xl (1120) a wide editor
 * Side panels (`SidePanel`) are for work that stays in context of the page behind it (a record's detail or a
 * multi-step create); dialogs are for a decision or a short task.
 */

type Tone = "default" | "danger";

type TextComponent = React.ComponentType<{ className?: string; children?: ReactNode }>;

// The visible title/description ARE the dialog's accessible name and description, so each shell passes its own Radix parts.
function Header({
  icon,
  title,
  description,
  tone = "default",
  trailing,
  Title,
  Description,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  tone?: Tone;
  trailing?: ReactNode;
  Title: TextComponent;
  Description: TextComponent;
}) {
  return (
    <div className="flex items-start gap-4 px-6 pb-4 pt-6 pr-16">
      {icon ? (
        <IconChip className={cn("h-10 w-10", tone === "danger" && "bg-[var(--ds-color-danger-500)]/15 text-[var(--ds-color-danger-400)]")}>{icon}</IconChip>
      ) : null}
      <div className="min-w-0 flex-1">
        <Title className="text-lg font-semibold leading-tight tracking-tight text-[var(--ds-on-surface)]">{title}</Title>
        {description ? <Description className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">{description}</Description> : null}
      </div>
      {trailing}
    </div>
  );
}

export interface ModalFooterProps {
  /** Left side: what the action will do ("3 services · ₹4.2L"). Keep it a fact, not a hint. */
  summary?: ReactNode;
  secondary?: { label?: string; onClick: () => void; disabled?: boolean };
  primary?: { label: string; onClick?: () => void; type?: "button" | "submit"; form?: string; loading?: boolean; disabled?: boolean; icon?: ReactNode };
  /** A destructive primary (delete, void, remove). */
  danger?: boolean;
  /** Extra controls between the summary and the actions (a checkbox, a link). */
  extra?: ReactNode;
}

export function ModalFooter({ summary, secondary, primary, danger, extra }: ModalFooterProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 bg-white/[0.03] px-6 py-4">
      {summary ? <div className="min-w-0 flex-1 text-sm text-[var(--ds-on-surface-muted)]">{summary}</div> : <div className="flex-1" />}
      {extra}
      <div className="flex items-center gap-2">
        {secondary ? (
          <Button type="button" variant="secondary" className="rounded-xl" onClick={secondary.onClick} disabled={secondary.disabled}>
            {secondary.label ?? "Cancel"}
          </Button>
        ) : null}
        {primary ? (
          <Button
            type={primary.type ?? "button"}
            form={primary.form}
            onClick={primary.onClick}
            disabled={primary.disabled || primary.loading}
            className={cn(
              "rounded-xl",
              danger && "bg-[var(--ds-color-danger-500)]/15 bg-none text-[var(--ds-color-danger-400)] hover:bg-[var(--ds-color-danger-500)]/25",
            )}
          >
            {primary.loading ? <IconLoader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : primary.icon ? <span className="mr-2 flex">{primary.icon}</span> : null}
            {primary.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** A titled group inside a modal body: mono label, optional description, then its content. */
export function ModalSection({ title, description, children, className }: { title?: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {title || description ? (
        <header>
          {title ? <h3 className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{title}</h3> : null}
          {description ? <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Label, control, hint and error in one consistent stack. */
export function ModalField({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--ds-color-danger-400)]" aria-hidden> *</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-[var(--ds-on-surface-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: DialogSize;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  /** Usually a `ModalFooter`. */
  footer?: ReactNode;
  /** A second pane on the right (selection summary, preview): scrolls on its own, stacks below the main pane on a phone. */
  aside?: ReactNode;
  asideWidth?: number;
  /** false for flows that must not be dismissed by a stray click (unsaved work in progress). Esc and the close button still work. */
  dismissOnOutsideClick?: boolean;
  bodyClassName?: string;
  children: ReactNode;
}

export function Modal({
  open,
  onOpenChange,
  size = "md",
  title,
  description,
  icon,
  tone,
  footer,
  aside,
  asideWidth = 340,
  dismissOnOutsideClick = true,
  bodyClassName,
  children,
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size={size}
        onInteractOutside={dismissOnOutsideClick ? undefined : (e) => e.preventDefault()}
        className="flex max-h-[min(92dvh,900px)] flex-col gap-0 overflow-hidden p-0"
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <Header icon={icon} title={title} description={description} tone={tone} Title={DialogTitle} Description={DialogDescription} />
        <div
          className={cn(
            "custom-scrollbar min-h-0 flex-1 overflow-y-auto",
            aside && "lg:grid lg:overflow-hidden",
          )}
          style={aside ? ({ gridTemplateColumns: `minmax(0,1fr) ${asideWidth}px` } as React.CSSProperties) : undefined}
        >
          <div className={cn("min-h-0 px-6 pb-6", aside && "lg:overflow-y-auto lg:custom-scrollbar", bodyClassName)}>{children}</div>
          {aside ? <aside className="min-h-0 bg-white/[0.03] p-5 lg:overflow-y-auto">{aside}</aside> : null}
        </div>
        {footer}
      </DialogContent>
    </Dialog>
  );
}

export interface SidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: "sm" | "md" | "lg" | "xl";
  side?: "left" | "right";
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  /** Header controls next to the close button (status chip, a menu). */
  headerTrailing?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}

/** A side sheet with the same header, body scroll and footer as `Modal`. */
export function SidePanel({ open, onOpenChange, size = "md", side = "right", title, description, icon, footer, headerTrailing, bodyClassName, children }: SidePanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} size={size} className="flex flex-col gap-0 p-0">
        <Header icon={icon} title={title} description={description} trailing={headerTrailing} Title={SheetTitle} Description={SheetDescription} />
        <div className={cn("custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-6", bodyClassName)}>{children}</div>
        {footer}
      </SheetContent>
    </Sheet>
  );
}
