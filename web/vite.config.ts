import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Where `scripts/dev.sh` (or you) runs the Go server during development.
// The production binary embeds web/dist, so in dev nothing is embedded and
// every /api and /ws call is proxied to a live server instead.
const backend = process.env.HERDR_DEV_BACKEND ?? "http://127.0.0.1:7681";
const port = Number(process.env.HERDR_DEV_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.HERDR_DEV_HOST ?? "127.0.0.1",
    port,
    strictPort: true,
    proxy: {
      "/api": {
        target: backend,
        changeOrigin: true,
      },
      "/ws": {
        target: backend.replace(/^http/, "ws"),
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
