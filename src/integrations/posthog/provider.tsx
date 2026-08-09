import { createClientOnlyFn } from "@tanstack/react-start";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

const loadClientPostHogProvider = createClientOnlyFn(() => import("./provider.client"));
const ClientPostHogProvider = lazy(() => loadClientPostHogProvider());

type PostHogProviderProps = {
  children: ReactNode;
};

const PostHogProvider = ({ children }: PostHogProviderProps) => {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated) {
    return children;
  }

  return (
    <Suspense fallback={children}>
      <ClientPostHogProvider>{children}</ClientPostHogProvider>
    </Suspense>
  );
};

export default PostHogProvider;
