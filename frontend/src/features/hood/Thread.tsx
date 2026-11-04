/* 대화 한 줄기: 쌓인 답변들 + 기다리는 질문. 새 칸만 아래에서 살짝 올라오며 나타난다(처음부터 있던 칸은 그대로).
   기다리던 칸은 답이 오면 바로 빠지고 같은 질문의 답 칸이 그 자리에 올라온다 */
import { AnimatePresence, motion } from "motion/react";
import { fadeUp } from "@/lib/motion";
import type { Conv, Slot } from "./store";
import { PendingBody, TurnView } from "./Turn";

export function Thread({ conv, slot, compact }: { conv: Conv; slot: Slot; compact: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {conv.turns.map((t) => (
        <motion.article key={`${conv.key}-${t.message_id}`} className="turn" {...fadeUp}>
          <TurnView t={t} slot={slot} compact={compact} />
        </motion.article>
      ))}
      {conv.pending && (
        <motion.article key={`${conv.key}-pending`} className="turn is-pending" aria-busy="true"
          initial={fadeUp.initial} animate={fadeUp.animate} exit={{ opacity: 0, transition: { duration: 0 } }} transition={fadeUp.transition}>
          <PendingBody q={conv.pending} />
        </motion.article>
      )}
    </AnimatePresence>
  );
}
