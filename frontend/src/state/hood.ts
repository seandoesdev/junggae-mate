/* Ask Hood 패널 열림 상태 — 상단 버튼, '/' 단축키, 지도 질문 결과의 '이어 묻기'가 함께 쓴다.
   prefill: 패널을 열면서 입력창에 넣어 둘 질문(있으면 Hood 패널이 꺼내 쓰고 비운다). */
import { useSyncExternalStore } from "react";

type HoodPanelState = { open: boolean; prefill: string | null };

let state: HoodPanelState = { open: false, prefill: null };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const hoodPanel = {
  get: () => state,
  open(prefill: string | null = null) { state = { open: true, prefill: prefill ?? state.prefill }; emit(); },
  close() { state = { ...state, open: false }; emit(); },
  toggle() { state = { ...state, open: !state.open }; emit(); },
  takePrefill() { const p = state.prefill; if (p) { state = { ...state, prefill: null }; emit(); } return p; },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};

export function useHoodPanel() {
  return useSyncExternalStore(hoodPanel.subscribe, hoodPanel.get);
}
