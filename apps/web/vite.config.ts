import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Static site only — no server, no SSR (SPEC.md §9.1). Offline/installable
// PWA support is built into the shell from Phase 1 rather than retrofitted
// later (SPEC.md §9.8, §13 Phase 1).
export default defineConfig(({ command }) => ({
  // GitHub Pages serves a project repo (not a username.github.io root repo)
  // from /<repo-name>/, not /, so every asset URL needs that prefix in a
  // production build — but the dev server still serves from / locally.
  base: command === "build" ? "/financial-planning/" : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt", // a new deploy prompts the user to refresh, never swaps silently (SPEC.md §9.8)
      includeAssets: ["icons/*.svg"],
      manifest: {
        name: "UK Retirement Planner",
        short_name: "Retirement Planner",
        description:
          "A UK retirement and financial planning calculator that runs entirely in your browser — nothing is ever sent to a server.",
        theme_color: "#1c7ed6",
        background_color: "#ffffff",
        display: "standalone",
        // Relative, not "/" — resolves correctly under GitHub Pages' /financial-planning/
        // base path without hardcoding it a second time here.
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icons/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // Cache the app shell and bundled tax-year data on first load so
        // the app is fully usable offline afterwards (SPEC.md §9.8).
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
      },
    }),
  ],
}));
