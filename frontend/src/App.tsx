/* 앱 껍데기: 로그인 전에는 로그인 화면, 뒤에는 상단바 + 주소(#/…)에 맞는 화면 + Ask Hood 패널.
   주소가 바뀌면 출처 패널과 대화상자를 닫는다(예전 route()와 같다). 화면 코드는 features/* 에서 나눠 불러온다. */
import { motion } from "motion/react";
import { Suspense, lazy, useEffect, type ComponentType } from "react";
import { LoginScreen } from "@/components/LoginScreen";
import { Topbar } from "@/components/Topbar";
import { DUR, EASE_OUT } from "@/lib/motion";
import { navigate, useRoute, type Page } from "@/lib/router";
import { hoodPanel } from "@/state/hood";
import { useSession } from "@/state/session";
import { useSources } from "@/state/sources";
import { useUi } from "@/state/ui";

export type ViewProps = { a?: string; b?: string };

const VIEWS: Record<Page, ComponentType<ViewProps>> = {
  map: lazy(() => import("@/features/map/MapView")),
  ai: lazy(() => import("@/features/hood/AiView")),
  deals: lazy(() => import("@/features/deals/DealsView")),
  customers: lazy(() => import("@/features/customers/CustomersView")),
  library: lazy(() => import("@/features/library/LibraryView")),
  public: lazy(() => import("@/features/public/PublicView")),
  report: lazy(() => import("@/features/report/ReportView")),
};
const HoodPanel = lazy(() => import("@/features/hood/HoodPanel"));

function Shell() {
  const route = useRoute();
  const { user } = useSession();
  const { close: closeSource } = useSources();
  const { closeDialog } = useUi();
  // 관리자 전용 화면은 관리자가 아니면 지도로
  const page: Page = route.page === "public" && user?.role !== "admin" ? "map" : route.page;
  const View = VIEWS[page];

  useEffect(() => {
    closeSource();
    closeDialog();
  }, [route.hash, closeSource, closeDialog]);

  // 주소도 지도로 바꿔 둔다 (예전 route()와 같다)
  useEffect(() => {
    if (route.page !== page) navigate("#/map");
  }, [route.page, page]);

  // '/' 를 누르면 어디서든 Ask Hood (입력 중이면 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.closest("input, textarea, select, [contenteditable=true]")) return;
      if (document.querySelector("#dialog[open]")) return;   // 대화상자가 떠 있으면 그 뒤에 패널을 열지 않는다
      e.preventDefault();
      hoodPanel.open();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div id="app">
      <Topbar page={page} />
      <Suspense fallback={<main className="view view-page" aria-busy="true" />}>
        {/* 화면 전환: 새 화면만 짧게 나타난다 (나가는 화면은 기다리지 않는다) */}
        <motion.div
          key={page}
          className="view-host"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: DUR.fast, ease: EASE_OUT }}
        >
          <View a={route.a} b={route.b} />
        </motion.div>
      </Suspense>
      <Suspense fallback={null}>
        <HoodPanel />
      </Suspense>
    </div>
  );
}

export default function App() {
  const { user, booting } = useSession();
  if (booting) return null;
  return user ? <Shell /> : <LoginScreen />;
}
