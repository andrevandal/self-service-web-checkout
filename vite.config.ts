import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { envOnlyMacros } from "vite-env-only";
import ViteEnv from "@vite-env/core/plugin";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const config = defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    tailwindcss(),
    ViteEnv({ configFile: "./src/env.ts" }),
    ...envOnlyMacros(),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;
