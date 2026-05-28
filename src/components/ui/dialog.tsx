import { type ReactNode, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "relative z-10 w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 shadow-2xl",
          className
        )}
      >
        {title && (
          <h2 className="mb-4 text-base font-semibold text-[var(--text-primary)]">{title}</h2>
        )}
        {children}
      </div>
    </div>
  );
}

interface DialogFooterProps { children: ReactNode; className?: string }
export function DialogFooter({ children, className }: DialogFooterProps) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)}>{children}</div>;
}
