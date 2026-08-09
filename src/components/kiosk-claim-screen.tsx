import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ArrowRight, KeyRound, Store } from "lucide-react";
import { KioskShell } from "#/components/kiosk-shell";
import {
  claimKiosk,
  listKiosks,
  verifySetupPassword,
  type ClaimKioskInput,
} from "#/lib/kiosk.functions";

const normalizePrefix = (value: string): string | null => {
  const prefix = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,5}$/.test(prefix) ? prefix : null;
};
const claimErrorCopy: Record<string, string> = {
  invalid_password: "That setup password is not correct.",
  configuration: "Kiosk setup is temporarily unavailable. Try again.",
  invalid_input: "Enter a kiosk name and a valid order prefix.",
  kiosk_not_found: "That kiosk is no longer available. Refresh the list and try again.",
  prefix_taken: "That order prefix is already in use. Choose another one.",
};

const errorCopy = (error: unknown, fallback: string) => {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    if (typeof code === "string" && code in claimErrorCopy) {
      return claimErrorCopy[code];
    }
  }
  if (error instanceof Error && error.message in claimErrorCopy) {
    return claimErrorCopy[error.message];
  }
  return fallback;
};

export const KioskClaimScreen = () => {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [setupReady, setSetupReady] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const kiosksQuery = useQuery({
    queryKey: ["kiosks"],
    queryFn: () => listKiosks(),
    enabled: setupReady,
  });

  const claimMutation = useMutation({
    mutationFn: (data: ClaimKioskInput) => claimKiosk({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["kiosk-session"] });
      window.location.reload();
    },
  });

  const verifyPasswordMutation = useMutation({
    mutationFn: (data: { password: string }) => verifySetupPassword({ data }),
    onSuccess: () => {
      setPasswordError(null);
      setSetupReady(true);
    },
    onError: (error) => {
      setPasswordError(errorCopy(error, "We could not verify that password. Try again."));
    },
  });

  const continueSetup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password.trim()) {
      setPasswordError("Enter the shared setup password to continue.");
      return;
    }
    setPasswordError(null);
    verifyPasswordMutation.mutate({ password });
  };

  const claimExisting = (kioskId: string) => {
    setFormError(null);
    claimMutation.mutate({ password, kioskId });
  };

  const createKiosk = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedPrefix = prefix.trim() ? normalizePrefix(prefix) : undefined;
    if (!normalizedName) {
      setFormError("Enter a name for this kiosk.");
      return;
    }
    if (prefix.trim() && !normalizedPrefix) {
      setFormError("Use 1–5 letters or numbers for the order prefix.");
      return;
    }
    setFormError(null);
    claimMutation.mutate({
      password,
      name: normalizedName,
      ...(normalizedPrefix ? { prefix: normalizedPrefix } : {}),
    });
  };

  const mutationError = claimMutation.error
    ? errorCopy(claimMutation.error, "We could not claim that kiosk. Try again.")
    : null;

  return (
    <KioskShell
      header={
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-5 py-4">
          <Store aria-hidden className="size-6" strokeWidth={2} />
          <span className="text-heading-s font-semibold">Warm & Melted</span>
          <span className="text-body-s text-muted-foreground">Staff setup</span>
        </div>
      }
      bottomBar={
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
          <p className="text-body-s text-muted-foreground" data-testid="setup-status">
            This tablet is not claimed
          </p>
          <KeyRound aria-hidden className="size-5 text-muted-foreground" strokeWidth={2} />
        </div>
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-8 sm:py-12">
        <div className="max-w-2xl">
          <p className="text-body-s font-semibold text-primary">Staff setup</p>
          <h1 className="mt-3 text-display-m font-extrabold leading-tight">Set up this kiosk</h1>
          <p className="mt-4 text-body-l text-muted-foreground">
            Enter the shared setup password to choose which kiosk this tablet should run.
          </p>
        </div>

        {!setupReady ? (
          <form
            className="flex max-w-xl flex-col gap-5 rounded-lg bg-card p-6 shadow-md sm:p-8"
            onSubmit={continueSetup}
          >
            <div className="flex flex-col gap-2">
              <label className="text-body-m font-semibold" htmlFor="setup-password">
                Shared setup password
              </label>
              <input
                autoComplete="off"
                className="min-h-12 rounded-md border border-input bg-background px-4 py-3 text-body-l outline-none transition-shadow focus-visible:shadow-focus"
                id="setup-password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
              {passwordError ? (
                <p aria-live="polite" className="text-body-s text-destructive">
                  {passwordError}
                </p>
              ) : null}
            </div>
            <button
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={verifyPasswordMutation.isPending}
              type="submit"
            >
              {verifyPasswordMutation.isPending ? "Verifying…" : "Continue"}
              <ArrowRight aria-hidden size={20} strokeWidth={2} />
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-6">
            <section aria-labelledby="choose-kiosk-heading" className="flex flex-col gap-4">
              <div>
                <h2 className="text-heading-l font-bold" id="choose-kiosk-heading">
                  Choose a kiosk
                </h2>
                <p className="mt-2 text-body-m text-muted-foreground">
                  Claim an existing kiosk or create a new one for this tablet.
                </p>
              </div>
              <div aria-live="polite" className="flex flex-col gap-3">
                {kiosksQuery.isLoading ? (
                  <p className="rounded-md bg-card p-5 text-body-m text-muted-foreground">
                    Loading kiosks…
                  </p>
                ) : null}
                {kiosksQuery.isError ? (
                  <p className="rounded-md bg-danger-subtle p-5 text-body-m text-destructive">
                    We could not load kiosks. Refresh and try again.
                  </p>
                ) : null}
                {kiosksQuery.data?.map((kiosk) => (
                  <button
                    className="flex min-h-16 items-center justify-between gap-4 rounded-md border border-border bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:shadow-focus"
                    disabled={claimMutation.isPending}
                    key={kiosk.id}
                    onClick={() => claimExisting(kiosk.id)}
                    type="button"
                  >
                    <span>
                      <span className="block text-heading-s font-semibold">{kiosk.name}</span>
                      <span className="mt-1 block text-body-s text-muted-foreground">
                        Order prefix {kiosk.prefix}
                      </span>
                    </span>
                    <span className="text-body-s font-semibold text-primary">
                      {claimMutation.isPending ? "Claiming…" : `Claim ${kiosk.name}`}
                    </span>
                  </button>
                ))}
                {!kiosksQuery.isLoading &&
                !kiosksQuery.isError &&
                kiosksQuery.data?.length === 0 ? (
                  <p className="rounded-md bg-card p-5 text-body-m text-muted-foreground">
                    No kiosks exist yet. Create the first one below.
                  </p>
                ) : null}
              </div>
            </section>

            <section
              aria-labelledby="create-kiosk-heading"
              className="rounded-lg bg-card p-6 shadow-md sm:p-8"
            >
              <h2 className="text-heading-l font-bold" id="create-kiosk-heading">
                Create a new kiosk
              </h2>
              <form className="mt-5 flex flex-col gap-5" onSubmit={createKiosk}>
                <div className="flex flex-col gap-2">
                  <label className="text-body-m font-semibold" htmlFor="kiosk-name">
                    Kiosk name
                  </label>
                  <input
                    className="min-h-12 rounded-md border border-input bg-background px-4 py-3 text-body-l outline-none transition-shadow focus-visible:shadow-focus"
                    id="kiosk-name"
                    onChange={(event) => setName(event.target.value)}
                    value={name}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-body-m font-semibold" htmlFor="kiosk-prefix">
                    Order prefix
                  </label>
                  <input
                    className="min-h-12 rounded-md border border-input bg-background px-4 py-3 text-body-l uppercase outline-none transition-shadow focus-visible:shadow-focus"
                    id="kiosk-prefix"
                    inputMode="text"
                    maxLength={5}
                    onChange={(event) => setPrefix(event.target.value)}
                    value={prefix}
                  />
                  <p className="text-body-s text-muted-foreground">
                    Optional. Use 1–5 letters or numbers.
                  </p>
                </div>
                {formError || mutationError ? (
                  <p aria-live="polite" className="text-body-s text-destructive">
                    {formError ?? mutationError}
                  </p>
                ) : null}
                <button
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.97]"
                  disabled={claimMutation.isPending}
                  type="submit"
                >
                  {claimMutation.isPending ? "Creating…" : "Create kiosk"}
                  <ArrowRight aria-hidden size={20} strokeWidth={2} />
                </button>
              </form>
            </section>
          </div>
        )}
      </div>
    </KioskShell>
  );
};
