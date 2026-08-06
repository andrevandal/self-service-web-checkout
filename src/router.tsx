import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const routerOptions = {
  routeTree,
  scrollRestoration: true,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
} as const;

export const getRouter = () => createTanStackRouter(routerOptions);

const router = getRouter();
export type AppRouter = typeof router;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
