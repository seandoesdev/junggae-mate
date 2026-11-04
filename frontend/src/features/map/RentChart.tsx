/* 매물 상세 공공데이터의 전월세 칸: 같은 단지·비슷한 면적의 최근 전세 보증금 추이를 작은 선으로 보인다 (Bklit LineSparkline).
   선은 최저~최고 사이로 그리므로 아래 숫자(마우스를 올린 거래, 기본은 최근 거래)와 함께 읽는다.
   자료: GET /public-data/rents (공공데이터 수집 캐시). 전세 신고가 2건보다 적으면 그리지 않는다. */
import { useEffect, useState } from "react";
import { LineSparkline, useSparklineHover } from "@/components/charts/sparkline";
import { api } from "@/lib/api";
import { day, eok } from "@/lib/format";
import type { Listing, RentRow } from "./types";
import { SEOUL_LAWD } from "./util";

type Point = { date: string; deposit: number; floor: number | null };

export function RentChart({ listing }: { listing: Listing }) {
  const [rows, setRows] = useState<Point[] | null>(null);
  const hover = useSparklineHover<Point>();
  const lawd = listing.address?.startsWith("서울") ? SEOUL_LAWD[listing.district] : undefined;

  useEffect(() => {
    if (!lawd || !listing.complex_name || !(listing.area_m2 > 0)) return;
    const ctl = new AbortController();
    const qs = new URLSearchParams({ lawd_cd: lawd, complex_name: listing.complex_name, area_m2: String(listing.area_m2) });
    api<{ items: RentRow[] }>("GET", `/public-data/rents?${qs}`, undefined, { signal: ctl.signal })
      .then((r) => setRows(
        r.items.filter((x) => x.rent_type === "jeonse" && x.deposit > 0)
          .map((x) => ({ date: x.contract_date, deposit: x.deposit, floor: x.floor }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      ))
      .catch(() => setRows(null));   // 그래프는 덧붙임이라 실패해도 알리지 않는다 (위 근거 문장이 그대로 있다)
    return () => ctl.abort();
  }, [lawd, listing.complex_name, listing.area_m2]);

  if (!rows || rows.length < 2) return null;
  const shown = hover.datum ?? rows[rows.length - 1];
  return (
    <div className="rent-spark">
      <div className="rent-spark-h">
        <span>최근 전세 {rows.length}건 · {eok(Math.min(...rows.map((r) => r.deposit)))}~{eok(Math.max(...rows.map((r) => r.deposit)))}</span>
        <span className="num">{day(shown.date)}{shown.floor != null ? ` · ${shown.floor}층` : ""} · <b>{eok(shown.deposit)}</b></span>
      </div>
      <LineSparkline
        data={rows}
        dataKey="deposit"
        height={34}
        color="var(--chart-1)"
        strokeWidth={1.75}
        endDot
        dot
        aria-label={`최근 전세 보증금 ${rows.map((r) => `${day(r.date)} ${eok(r.deposit)}`).join(", ")}`}
        {...hover.sparklineProps}
      />
    </div>
  );
}
