/* 지도 화면 안에서만 쓰는 작은 도우미 */
import { useCallback, useState } from "react";
import { useToast } from "@/state/ui";

/** 여러 버튼 중 지금 실행 중인 것 하나를 막는다. 오류는 알림(4.2초)으로 보여 주고 undefined를 돌려준다 (예전 busy()) */
export function useBusyKey() {
  const toast = useToast();
  const [key, setKey] = useState<string | null>(null);
  const run = useCallback(async <T,>(k: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setKey(k);
    try { return await fn(); }
    catch (e) { toast((e as Error).message, 4200); return undefined; }
    finally { setKey(null); }
  }, [toast]);
  return [key, run] as const;
}

/** 서울 구 이름 → 법정동 시군구 코드 5자리 (전월세 사례 조회용) */
export const SEOUL_LAWD: Record<string, string> = {
  종로구: "11110", 중구: "11140", 용산구: "11170", 성동구: "11200", 광진구: "11215", 동대문구: "11230",
  중랑구: "11260", 성북구: "11290", 강북구: "11305", 도봉구: "11320", 노원구: "11350", 은평구: "11380",
  서대문구: "11410", 마포구: "11440", 양천구: "11470", 강서구: "11500", 구로구: "11530", 금천구: "11545",
  영등포구: "11560", 동작구: "11590", 관악구: "11620", 서초구: "11650", 강남구: "11680", 송파구: "11710",
  강동구: "11740",
};

export const safeDecode = (s: string) => {
  try { return decodeURIComponent(s); } catch { return s; }
};
