import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` (UI only) proxies /api and the OAuth callbacks to a local `wrangler dev` on :8787.
    proxy: { "/api": "http://127.0.0.1:8787", "/oauth": "http://127.0.0.1:8787" },
  },
});
