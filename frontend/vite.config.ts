import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 화면은 FastAPI가 /app.html, /assets/* 로 내려준다. 개발 중에는 /api, /r 을 백엔드(8000)로 넘긴다.
const backend = process.env.API_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
    port: 5173,
    proxy: { "/api": backend, "/r/": backend },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false, // scripts/clean-dist.mjs가 먼저 비운다 (Windows Node 24 rmSync 문제)
    rollupOptions: { input: path.resolve(import.meta.dirname, "app.html") },
    chunkSizeWarningLimit: 900,
  },
});
