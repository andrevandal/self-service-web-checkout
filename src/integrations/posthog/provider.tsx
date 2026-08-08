import { PostHogProvider as BasePostHogProvider } from "@posthog/react";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { env } from "virtual:env/client";

if (typeof window !== "undefined" && env.VITE_POSTHOG_KEY) {
  posthog.init(env.VITE_POSTHOG_KEY, {
    api_host: env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: false,
    defaults: "2025-11-30",
  });
}

type PostHogProviderProps = {
  children: ReactNode;
};

const PostHogProvider = ({ children }: PostHogProviderProps) => (
  <BasePostHogProvider client={posthog}>{children}</BasePostHogProvider>
);

export default PostHogProvider;
