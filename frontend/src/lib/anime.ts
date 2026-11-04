/* anime.js v4 도우미 — 여러 요소를 차례로 보이기, SVG 선 그리기, 숫자 올라가기.
   모두 '동작 줄이기'를 존중한다: 켜져 있으면 바로 최종 상태로 둔다.
   React에서는 useEffect 안에서 부르고, 돌려준 정리 함수를 effect cleanup으로 반환한다. */
import { animate, createDrawable, stagger, utils } from "animejs";
import { reducedMotion } from "./motion";

type Targets = string | Element | Element[] | NodeListOf<Element> | null | undefined;

const list = (t: Targets): Element[] => {
  if (!t) return [];
  if (typeof t === "string") return Array.from(document.querySelectorAll(t));
  if (t instanceof Element) return [t];
  return Array.from(t as ArrayLike<Element>);
};

const noop = () => {};

/** 요소들을 아래에서 살짝 올라오며 차례로 보인다 (기본 간격 40ms, 220ms) */
export function staggerIn(targets: Targets, opts: { delay?: number; gap?: number; y?: number; duration?: number } = {}) {
  const els = list(targets);
  if (!els.length) return noop;
  if (reducedMotion()) {
    utils.set(els, { opacity: 1, translateY: 0 });
    return noop;
  }
  const a = animate(els, {
    opacity: [0, 1],
    translateY: [opts.y ?? 6, 0],
    duration: opts.duration ?? 220,
    delay: stagger(opts.gap ?? 40, { start: opts.delay ?? 0 }),
    ease: "out(3)",
  });
  return () => { a.revert(); };
}

/** SVG path/line/polyline을 그려 나간다. 진행 표시·거래 단계 선에 쓴다 */
export function drawIn(targets: Targets, opts: { delay?: number; duration?: number; gap?: number } = {}) {
  const els = list(targets).filter((e): e is SVGGeometryElement => e instanceof SVGGeometryElement);
  if (!els.length || reducedMotion()) return noop;
  const drawables = createDrawable(els);
  const a = animate(drawables, {
    draw: ["0 0", "0 1"],
    duration: opts.duration ?? 420,
    delay: stagger(opts.gap ?? 60, { start: opts.delay ?? 0 }),
    ease: "inOut(2)",
  });
  return () => { a.revert(); };
}

/** 숫자를 0(또는 from)에서 to까지 올린다. format으로 표기를 정한다 */
export function countUp(
  el: Element | null,
  to: number,
  opts: { from?: number; duration?: number; format?: (n: number) => string } = {},
) {
  if (!el) return noop;
  const fmt = opts.format ?? ((n: number) => Math.round(n).toLocaleString("ko-KR"));
  if (reducedMotion() || !Number.isFinite(to)) {
    el.textContent = fmt(to);
    return noop;
  }
  const state = { v: opts.from ?? 0 };
  const a = animate(state, {
    v: to,
    duration: opts.duration ?? 600,
    ease: "out(3)",
    onUpdate: () => { el.textContent = fmt(state.v); },
  });
  return () => { a.pause(); el.textContent = fmt(to); };
}
