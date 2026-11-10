import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/shell.css";
import App from "./App";
import { loadConfig } from "./lib/config";
import { SessionProvider } from "./state/session";
import { SourcesProvider } from "./state/sources";
import { UiLayer, UiProvider } from "./state/ui";

// 화면을 열 때마다 새로 받는다 (예전 화면처럼). 다른 화면에서 바꾼 거래·고객 자료가 바로 보이도록 캐시를 신선하다고 보지 않는다
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 } },
});

// API 서버 주소(Cloudflare Worker의 /config.json)를 먼저 받고 화면을 그린다
await loadConfig();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* 시스템의 '동작 줄이기'를 따른다 */}
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <UiProvider>
            <SourcesProvider>
              <App />
              <UiLayer />
            </SourcesProvider>
          </UiProvider>
        </SessionProvider>
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
);
