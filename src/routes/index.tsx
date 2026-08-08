import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Store } from "lucide-react";
import { KioskShell } from "#/components/kiosk-shell";

const Home = () => {
  return (
    <KioskShell
      header={
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <Store aria-hidden className="size-6" strokeWidth={2} />
            <span className="text-heading-s font-semibold">Warm & Melted</span>
          </div>
          <span className="text-body-s text-muted-foreground">Kiosk 01</span>
        </div>
      }
      bottomBar={
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <div>
            <p className="text-body-s text-muted-foreground">Current order</p>
            <p className="font-mono text-heading-m font-medium" data-testid="kiosk-price">
              $12.50
            </p>
          </div>
          <button
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.97]"
            data-testid="kiosk-primary-action"
            type="button"
          >
            View cart
            <ArrowRight aria-hidden size={20} strokeWidth={2} />
          </button>
        </div>
      }
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8">
        <div className="max-w-2xl">
          <p className="text-body-s font-medium text-primary" data-testid="kiosk-ui-copy">
            Ready when you are
          </p>
          <h1 className="mt-3 text-display-m font-extrabold leading-tight">
            Self-service web checkout
          </h1>
          <p className="mt-4 max-w-xl text-body-l text-muted-foreground">
            Browse the menu and build your order at your own pace.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Menu preview">
          {Array.from({ length: 9 }, (_, index) => (
            <article className="rounded-md bg-card p-5 shadow-sm" key={index}>
              <div className="mb-5 aspect-[4/3] rounded-md bg-secondary" />
              <h2 className="text-heading-s font-semibold">House special {index + 1}</h2>
              <p className="mt-2 text-body-s text-muted-foreground">Made fresh for you.</p>
            </article>
          ))}
        </div>
      </div>
    </KioskShell>
  );
};

export const Route = createFileRoute("/")({ component: Home });
