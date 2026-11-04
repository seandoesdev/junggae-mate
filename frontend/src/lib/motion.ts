/* 움직임 규칙 — 업무 도구라서 절제한다.
   - 길이: 짧은 피드백 150ms, 기본 220ms, 패널·시트 300ms 안팎. 이보다 길게 끌지 않는다.
   - 키보드로 하는 동작, 지도 이동·확대, 자주 반복되는 목록 갱신에는 움직임을 넣지 않는다.
   - 시스템의 '동작 줄이기'를 켜면 MotionConfig(reducedMotion="user")와 anime 도우미가 움직임을 끈다.
   역할 분담: Motion(motion/react) = 화면 요소의 등장·퇴장·전환·스프링,
             anime.js(lib/anime.ts) = 여러 단계 연출과 SVG 선 그리기, 숫자 올라가기. */

export const DUR = { fast: 0.15, base: 0.22, slow: 0.3 } as const;

/** CSS의 --ease 와 같은 곡선 */
export const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;

/** 패널·시트처럼 큰 면이 들어올 때. 튀지 않게 감쇠를 크게 */
export const SPRING_PANEL = { type: "spring", stiffness: 420, damping: 40, mass: 0.9 } as const;
/** 버튼·칩처럼 작은 요소 */
export const SPRING_SNAPPY = { type: "spring", stiffness: 700, damping: 45 } as const;

export const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 목록·카드가 조용히 나타날 때 (motion 컴포넌트에 펼쳐 쓴다) */
export const fadeUp = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: DUR.base, ease: EASE_OUT },
} as const;

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DUR.fast, ease: EASE_OUT },
} as const;

/** 누를 때 살짝 눌리는 느낌 (whileTap) */
export const press = { scale: 0.97 } as const;
