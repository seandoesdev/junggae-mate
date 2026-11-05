import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Connect, type Plugin } from "vite";

// 화면은 FastAPI가 /app.html, /assets/* 로 내려준다. 개발 중에는 /api, /r 을 백엔드(8000)로 넘긴다.
const backend = process.env.API_URL ?? "http://localhost:8000";

/** 개발·미리보기 서버의 /config.json: /api를 같은 주소로 넘기므로 API 주소는 비워 둔다 (Cloudflare에서는 Pages Function) */
function sameOriginConfig(): Plugin {
  const handle: Connect.NextHandleFunction = (req, res, next) => {
    if ((req.url || "").split("?")[0] !== "/config.json") return next();
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end('{"apiUrl":""}');
  };
  return {
    name: "same-origin-config",
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), sameOriginConfig()],
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
