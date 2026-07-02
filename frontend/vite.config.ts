import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // Proxy REST + WS to the FastAPI backend during local dev so the
    // frontend talks to same-origin paths (no CORS juggling).
    proxy: {
      // Use 127.0.0.1 (not "localhost") — on Windows "localhost" can resolve to
      // IPv6 ::1 first and miss an IPv4-only backend.
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/ws": {
        // Target must use the http scheme even for WebSockets; `ws: true`
        // handles the upgrade. Using a `ws://` target makes Vite's proxy
        // reject the handshake with 403.
        target: "http://127.0.0.1:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
