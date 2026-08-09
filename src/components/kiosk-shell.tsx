import type { ReactNode } from "react";

type KioskShellProps = {
  header: ReactNode;
  children: ReactNode;
  bottomBar: ReactNode;
};

export const KioskShell = ({ header, children, bottomBar }: KioskShellProps) => {
  return (
    <div
      className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-background text-foreground"
      data-testid="kiosk-shell"
    >
      <header className="flex-none border-b border-border bg-background" data-testid="kiosk-header">
        {header}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto" data-testid="kiosk-content">
        {children}
      </main>
      <footer
        className="flex-none border-t border-border bg-card px-5 py-4 shadow-md [padding-bottom:calc(1rem+env(safe-area-inset-bottom))]"
        data-testid="kiosk-bottom-bar"
      >
        {bottomBar}
      </footer>
    </div>
  );
};
