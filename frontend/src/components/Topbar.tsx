/* 상단바: 로고·사무소 이름, 주요 메뉴(Hood AI는 지도 왼쪽, 마우스를 올리면 보고서·사용량·설정), Ask Hood, 로그아웃.
   활성 메뉴 밑줄은 Motion layoutId로 메뉴 사이를 미끄러지듯 옮긴다. */
import { motion } from "motion/react";
import { BrandMark, ChevIcon, SparkIcon } from "@/components/Icons";
import { SPRING_SNAPPY } from "@/lib/motion";
import type { Page } from "@/lib/router";
import { hoodPanel, useHoodPanel } from "@/state/hood";
import { useSession, useUser } from "@/state/session";

const Ind = () => <motion.span layoutId="nav-ind" className="nav-ind" transition={SPRING_SNAPPY} aria-hidden="true" />;

export function Topbar({ page }: { page: Page }) {
  const user = useUser();
  const { logout } = useSession();
  const panel = useHoodPanel();
  const active = page === "report" ? "customers" : page;
  const link = (to: Page, label: string) => (
    <a href={`#/${to}`} data-nav={to} className={active === to ? "is-active" : undefined}>
      {label}{active === to && <Ind />}
    </a>
  );

  return (
    <header className="topbar">
      <a className="brand" href="#/map">
        <BrandMark /><span>중개메이트</span><span className="office" id="office-name">{user.tenant_name}</span>
      </a>
      <nav className="nav" aria-label="주요 메뉴">
        <div className="nav-host">
          <a href="#/ai" data-nav="ai" aria-haspopup="true" className={active === "ai" ? "is-active" : undefined}>
            <SparkIcon className="nav-spark" />Hood AI<ChevIcon />{active === "ai" && <Ind />}
          </a>
          <div className="nav-menu" role="menu" aria-label="Hood AI">
            <a role="menuitem" href="#/ai/reports"><b>보고서</b><span>Hood AI 답변으로 만든 고객 자료</span></a>
            <a role="menuitem" href="#/ai/usage"><b>사용량</b><span>질문 수, 사람별, 쓴 자료</span></a>
            <a role="menuitem" href="#/ai/settings"><b>설정</b><span>답변에 쓸 자료와 방식</span></a>
          </div>
        </div>
        {link("map", "지도")}
        {link("deals", "거래")}
        {link("customers", "고객")}
        {link("library", "자료실")}
        {user.role === "admin" && link("public", "공공데이터")}
      </nav>
      <span className="me">
        <motion.button
          type="button"
          className="ask-hood"
          id="ask-hood-btn"
          data-act="hood-toggle"
          aria-controls="hood-panel"
          aria-expanded={panel.open}
          whileTap={{ scale: 0.97 }}
          onClick={() => hoodPanel.toggle()}
        >
          <SparkIcon /><span>Ask Hood</span>
        </motion.button>
        <span className="who-name" id="me-name">{user.name}{user.role === "admin" ? " (관리자)" : ""}</span>
        <button type="button" className="logout" data-act="logout" onClick={logout}>로그아웃</button>
      </span>
    </header>
  );
}
