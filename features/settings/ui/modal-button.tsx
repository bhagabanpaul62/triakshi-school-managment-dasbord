"use client";

import { useState, type ReactNode } from "react";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { Button } from "@smw/ui/ui/button";

/** A button that opens a read-only dialog around server-rendered `children` (a role's access list, a person's actions). */
export function ModalButton({ label, title, description, size = "md", variant = "ghost", children }: {
  label: string; title: string; description?: string; size?: "sm" | "md" | "lg"; variant?: "default" | "secondary" | "ghost"; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size="sm" className="rounded-full" onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onOpenChange={setOpen} size={size} title={title} description={description}
        footer={<ModalFooter secondary={{ label: "Close", onClick: () => setOpen(false) }} />}>
        <div className="flex flex-col gap-3 pt-2">{children}</div>
      </Modal>
    </>
  );
}
