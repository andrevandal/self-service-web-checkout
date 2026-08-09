import { useEffect, useRef, type KeyboardEvent } from "react";

export type AbandonmentDialogProps = {
  open: boolean;
  secondsRemaining: number;
  onKeepOrdering: () => void;
};

export const AbandonmentDialog = ({
  open,
  secondsRemaining,
  onKeepOrdering,
}: AbandonmentDialogProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepOrderingRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      keepOrderingRef.current?.focus();
      return;
    }
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onKeepOrdering();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      aria-hidden={!open}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/45 px-6 py-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onKeepOrdering();
        }
      }}
    >
      <div
        aria-labelledby="abandonment-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-lg bg-card p-8 text-center shadow-lg"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <p className="text-body-s font-semibold text-primary">Your cart is waiting</p>
        <h2 className="mt-2 text-heading-l font-bold" id="abandonment-title">
          Are you still ordering?
        </h2>
        <p aria-live="polite" className="mt-3 text-body-l text-muted-foreground">
          Cart clears in {secondsRemaining}s.
        </p>
        <button
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-pill bg-primary px-6 py-3 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={onKeepOrdering}
          ref={keepOrderingRef}
          type="button"
        >
          Keep ordering
        </button>
      </div>
    </div>
  );
};
