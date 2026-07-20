import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Static site only — no server, no SSR (SPEC.md §9.1). Offline/installable
// PWA support is built into the shell from Phase 1 rather than retrofitted
// later (SPEC.md §9.8, §13 Phase 1).
export default defineConfig({
  // Served from the custom domain's root (canistop.uk/), not a
  // /financial-planning/ subpath — no base prefix needed. Only a plain
  // github.io project-page URL (no custom domain) would need one.
  base: "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt", // a new deploy prompts the user to refresh, never swaps silently (SPEC.md §9.8)
      includeAssets: ["icons/*.svg"],
      manifest: {
        name: "Can I Stop? — UK Retirement Planner",
        short_name: "Can I Stop",
        description:
          "A UK retirement and financial planning calculator that runs entirely in your browser — nothing is ever sent to a server.",
        theme_color: "#1c7ed6",
        background_color: "#ffffff",
        display: "standalone",
        // Relative, not "/" — resolves correctly regardless of base path.
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
});
