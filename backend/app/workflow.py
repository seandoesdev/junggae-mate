"""거래(매물×고객×단계), 매물별 확인할 사항, 고객 자료(작성→검토→승인→전달)."""
import html
import re
import secrets
from datetime import date, datetime, timedelta, timezone

from . import assistant, drafting, hood, rag
from .audit import record
from .db import Jsonb

STAGE_LABEL = {"available": "거래 가능", "intro": "소개", "visit": "방문", "nego": "협의",
               "contract": "계약", "done": "완료", "dropped": "무산"}
NEXT_ACTION = {"intro": "매물 소개", "visit": "방문 일정 잡기", "nego": "가격·조건 협의",
               "contract": "계약서 작성·계약금 일정", "done": "잔금·인도 확인"}
SHARE_DAYS = 7


class Forbidden(PermissionError):
    pass


def log_activity(conn, customer_id: int, user_id: int | None, text: str) -> None:
    conn.execute("INSERT INTO activities (customer_id, user_id, text) VALUES (%s, %s, %s)", (customer_id, user_id, text))


# ---------- 거래 ----------

_DEAL_SQL = """
SELECT d.id, d.listing_id, d.customer_id, c.name AS customer_name, d.agent_id, ua.name AS agent_name, d.stage,
       d.next_action, d.dropped_reason, d.stage_changed_at, d.created_at,
       (current_date - d.stage_changed_at::date) AS days_in_stage,
       l.label AS l_label, l.title AS l_title, l.price AS l_price, l.agent_id AS l_agent_id, ul.name AS l_agent_name
FROM deals d
JOIN customers c ON c.id = d.customer_id
JOIN listings l ON l.id = d.listing_id
JOIN users ua ON ua.id = d.agent_id
LEFT JOIN users ul ON ul.id = l.agent_id
WHERE d.tenant_id = %(tenant)s {where}
ORDER BY d.stage_changed_at DESC, d.id DESC
"""


def _deal(row: dict) -> dict:
    return {
        "id": row["id"], "listing_id": row["listing_id"], "customer_id": row["customer_id"],
        "customer_name": row["customer_name"], "agent_id": row["agent_id"], "agent_name": row["agent_name"],
        "stage": row["stage"], "next_action": row["next_action"], "dropped_reason": row["dropped_reason"],
        "days_in_stage": row["days_in_stage"], "stage_changed_at": row["stage_changed_at"].isoformat(),
        "created_at": row["created_at"].isoformat(),
        "listing": {"id": row["listing_id"], "label": row["l_label"], "title": row["l_title"], "price": row["l_price"],
                    "agent_id": row["l_agent_id"], "agent_name": row["l_agent_name"]},
    }


def list_deals(conn, tenant_id: int, *, agent_id: int | None = None, listing_id: int | None = None,
               customer_id: int | None = None, deal_id: int | None = None) -> list[dict]:
    where, params = [], {"tenant": tenant_id}
    for col, val in (("agent_id", agent_id), ("listing_id", listing_id), ("customer_id", customer_id), ("id", deal_id)):
        if val is not None:
            where.append(f"AND d.{col} = %({col})s")
            params[col] = val
    return [_deal(r) for r in conn.execute(_DEAL_SQL.format(where=" ".join(where)), params).fetchall()]


def get_deal(conn, tenant_id: int, deal_id: int) -> dict | None:
    found = list_deals(conn, tenant_id, deal_id=deal_id)
    return found[0] if found else None


def create_deal(conn, user, listing: dict, customer: dict, next_action: str | None) -> dict:
    exists = conn.execute("SELECT id FROM deals WHERE listing_id = %s AND customer_id = %s",
                          (listing["id"], customer["id"])).fetchone()
    if exists:
        raise drafting.DomainError("이미 연결된 고객입니다.", 409)
    row = conn.execute(
        """INSERT INTO deals (tenant_id, listing_id, customer_id, agent_id, stage, next_action)
           VALUES (%s, %s, %s, %s, 'intro', %s) RETURNING id""",
        (user.tenant_id, listing["id"], customer["id"], customer["agent_id"], next_action or NEXT_ACTION["intro"]),
    ).fetchone()
    conn.execute("INSERT INTO deal_events (deal_id, from_stage, to_stage, user_id) VALUES (%s, NULL, 'intro', %s)", (row["id"], user.id))
    log_activity(conn, customer["id"], user.id, f"{listing['label']} {listing['title']} 소개")
    record(conn, tenant_id=user.tenant_id, user_id=user.id, event="deal.created", entity="deal", entity_id=row["id"],
           payload={"listing_id": listing["id"]})
    return get_deal(conn, user.tenant_id, row["id"])


def can_change_deal(user, deal: dict) -> bool:
    return user.role == "admin" or user.id in (deal["agent_id"], deal["listing"]["agent_id"])


def change_stage(conn, user, deal: dict, stage: str, reason: str | None) -> tuple[dict, list[str]]:
    if not can_change_deal(user, deal):
        raise Forbidden("거래 단계는 거래 담당·매물 담당 중개사나 관리자만 바꿀 수 있습니다.")
    if stage == "dropped" and not (reason or "").strip():
        raise drafting.DomainError("무산 사유를 적어 주세요.")
    if stage == deal["stage"]:
        return deal, []
    conn.execute(
        """UPDATE deals SET stage = %s, stage_changed_at = now(), dropped_reason = %s,
                            next_action = CASE WHEN %s = 'dropped' THEN NULL ELSE %s END WHERE id = %s""",
        (stage, reason.strip() if stage == "dropped" else None, stage, NEXT_ACTION.get(stage), deal["id"]),
    )
    conn.execute("INSERT INTO deal_events (deal_id, from_stage, to_stage, user_id) VALUES (%s, %s, %s, %s)",
                 (deal["id"], deal["stage"], stage, user.id))
    l = deal["listing"]
    text = f"{l['label']} {l['title']} {STAGE_LABEL[deal['stage']]}→{STAGE_LABEL[stage]}"
    log_activity(conn, deal["customer_id"], user.id, text + (f" ({reason.strip()})" if stage == "dropped" else ""))
    record(conn, tenant_id=user.tenant_id, user_id=user.id, event="deal.stage_changed", entity="deal", entity_id=deal["id"],
           payload={"from": deal["stage"], "to": stage})
    warnings = []
    if stage == "contract":
        others = conn.execute(
            "SELECT count(*) AS n FROM deals WHERE listing_id = %s AND id <> %s AND stage NOT IN ('dropped', 'done')",
            (deal["listing_id"], deal["id"])).fetchone()["n"]
        if others:
            warnings.append(f"같은 매물에 진행 중인 다른 거래가 {others}건 있습니다. 필요하면 무산으로 정리하세요.")
    return get_deal(conn, user.tenant_id, deal["id"]), warnings


# ---------- 매물별 확인할 사항 (문서 근거 검색) ----------

def _find(conn, tenant_id: int, query: str, region: str | None, *, types=None, must: str | None = None, k: int = 6):
    hits = rag.search(conn, tenant_id, query, region=region, k=k)
    return [h for h in hits if (not types or h["source_type"] in types) and (not must or must in h["text"])]


def listing_checks(conn, user, listing: dict) -> list[dict]:
    """매물의 가격·지역·거래 단계에 맞는 확인 항목을 만들고, 자료실 문서에서 출처를 찾아 붙인다."""
    region = drafting.region_of(listing["district"])
    items: list[dict] = []

    def add(key: str, text: str, level: str, hits: list[dict], evidence: dict | None = None):
        srcs = [(evidence or {}).get(f"c{h['id']}") or rag.to_evidence(h) for h in hits]
        items.append({"key": key, "text": text, "level": level, "sources": srcs})

    if listing["stage"] in ("contract", "done"):
        add("report", "계약일부터 30일 이내 실거래 신고 (매도·매수인 공동)", "urgent",
            _find(conn, user.tenant_id, "매매계약 체결일부터 30일 이내 신고", region, types={"law"}, must="30일")[:1])
    add("registry", "등기사항증명서로 권리관계(근저당·가압류 등) 확인", "normal",
        _find(conn, user.tenant_id, "등기사항증명서 권리관계 확인 근거자료 제시", region, must="등기사항증명서")[:2])
    add("building", "건축물대장으로 위반건축물·사용승인일 확인", "normal",
        _find(conn, user.tenant_id, "건축물대장 위반건축물 사용승인일 확인", region, must="건축물대장")[:1])

    hits = _find(conn, user.tenant_id, "생애최초 주택 구입 지원 대상 주택가격 시행일", region, types={"policy", "news"})
    gate = rag.evidence_gate(hits, as_of=date.today(), policy_question=True)
    policy = [h for h in hits if h["source_type"] == "policy" and "주택가격" in h["text"]]
    if policy:
        under = listing["price"] <= drafting.FIRST_HOME_PRICE_LIMIT
        add("first_home", "주택가격 9억 원 이하: 생애최초 구입 지원 가격 기준 해당 (소득·무주택 요건은 별도)" if under
            else "주택가격 9억 원 초과: 생애최초 구입 지원 가격 기준 밖", "normal", policy[:1], gate["evidence"])
        if under:
            by_id = {f"c{h['id']}": h for h in hits}
            for f in gate["findings"]:
                cited = [by_id[c] for c in f["citations"] if c in by_id]
                if f["kind"] == "conflict":
                    add("first_home_conflict", f"{f['label']}: 공식 안내 {f['ref_value']}, 기사 {f['other_value']}로 다름. 공식 안내 기준으로 설명",
                        "warn", cited, gate["evidence"])
                elif f["kind"] == "not_effective":
                    add("first_home_effective", f"생애최초 지원은 {f['effective_date']}부터 시행. 그 전 신청은 대상 아님",
                        "warn", cited[:1], gate["evidence"])

    school = _find(conn, user.tenant_id, f"{listing['complex_name']} 배정 학교 학구도", region, types={"office"}, must=listing["complex_name"])
    sent = drafting.sentence_with(school[0]["text"], listing["complex_name"]) if school else None
    if sent:
        add("school", sent.rstrip("."), "normal", school[:1])
    else:
        add("school", "배정 학교 자료 없음. 교육지원청 학구도 확인 필요", "warn", [])

    done = {r["key"]: r for r in conn.execute(
        """SELECT k.key, k.checked_at, u.name AS checked_by FROM listing_checks k LEFT JOIN users u ON u.id = k.checked_by
           WHERE k.listing_id = %s""", (listing["id"],))}
    for it in items:
        d = done.get(it["key"])
        it.update(checked=bool(d), checked_by=d["checked_by"] if d else None,
                  checked_at=d["checked_at"].isoformat() if d else None)
    return items


def set_check(conn, user, listing: dict, key: str, checked: bool) -> dict:
    if key not in {it["key"] for it in listing_checks(conn, user, listing)}:
        raise drafting.DomainError("없는 확인 항목입니다.", 404)
    if checked:
        conn.execute("""INSERT INTO listing_checks (listing_id, key, checked_by) VALUES (%s, %s, %s)
                        ON CONFLICT (listing_id, key) DO UPDATE SET checked_by = EXCLUDED.checked_by, checked_at = now()""",
                     (listing["id"], key, user.id))
    else:
        conn.execute("DELETE FROM listing_checks WHERE listing_id = %s AND key = %s", (listing["id"], key))
    record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.check", entity="listing", entity_id=listing["id"],
           payload={"key": key, "checked": checked})
    return next(it for it in listing_checks(conn, user, listing) if it["key"] == key)


# ---------- 고객 자료 ----------

def version_label(state: str, version: int) -> str:
    return "1.0" if state in ("approved", "shared") else f"0.{version}"


def create_report(conn, user, customer: dict, kind: str, *, listing_ids=None, question=None, quote_id=None,
                  drop=None) -> int:
    if kind == "compare":
        content = drafting.draft_compare(conn, user, customer, listing_ids)
    else:
        if not (question or "").strip():
            raise drafting.DomainError("고객 문의 내용을 적어 주세요.")
        content = assistant.answer(conn, user, question, customer=customer, quote_id=quote_id, dropped=drop,
                                   settings=hood.get_settings(conn, user.tenant_id))
    row = conn.execute(
        """INSERT INTO reports (tenant_id, customer_id, kind, title, question, listings, sources, gate, generator, created_by)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (user.tenant_id, customer["id"], kind, content["title"], (question or "").strip() or None,
         Jsonb(content["listings"]), Jsonb(content["sources"]), Jsonb(content["gate"]), content["generator"], user.id),
    ).fetchone()
    conn.execute("""INSERT INTO report_versions (report_id, version, opinion, to_check, note, created_by)
                    VALUES (%s, 1, %s, %s, '초안 작성', %s)""",
                 (row["id"], content["opinion"], Jsonb(content["to_check"]), user.id))
    log_activity(conn, customer["id"], user.id, f"{content['title']} 작성 시작")
    record(conn, tenant_id=user.tenant_id, user_id=user.id, event="report.created", entity="report", entity_id=row["id"],
           payload={"kind": kind, "generator": content["generator"], "sources": [s["id"] for s in content["sources"]],
                    "gate": content["gate"]["status"]})
    return row["id"]


def load_report(conn, tenant_id: int, report_id: int, *, base_url: str = "") -> dict | None:
    r = conn.execute(
        """SELECT r.*, c.name AS customer_name, c.agent_id, ua.name AS agent_name, ap.name AS approved_by_name
           FROM reports r JOIN customers c ON c.id = r.customer_id JOIN users ua ON ua.id = c.agent_id
           LEFT JOIN users ap ON ap.id = r.approved_by WHERE r.id = %s AND r.tenant_id = %s""",
        (report_id, tenant_id)).fetchone()
    if not r:
        return None
    versions = conn.execute(
        """SELECT v.version, v.opinion, v.to_check, v.note, v.created_at, u.name AS by FROM report_versions v
           LEFT JOIN users u ON u.id = v.created_by WHERE v.report_id = %s ORDER BY v.version DESC""", (report_id,)).fetchall()
    history = [{"version": f"0.{v['version']}", "note": v["note"], "at": v["created_at"].isoformat(), "by": v["by"]} for v in versions]
    if r["approved_at"]:
        history.insert(0, {"version": "1.0", "note": "승인", "at": r["approved_at"].isoformat(), "by": r["approved_by_name"]})
    share_info = None
    if r["share_token"]:
        share_info = {"url": f"{base_url}/r/{r['share_token']}", "expires_at": r["share_expires_at"].isoformat(),
                      "views": r["share_views"], "last_view": r["share_last_view"].isoformat() if r["share_last_view"] else None}
    return {
        "id": r["id"], "customer_id": r["customer_id"], "customer_name": r["customer_name"], "agent_id": r["agent_id"],
        "agent_name": r["agent_name"], "kind": r["kind"], "title": r["title"], "question": r["question"], "state": r["state"],
        "version": version_label(r["state"], r["version"]), "listings": r["listings"], "opinion": versions[0]["opinion"],
        "to_check": versions[0]["to_check"], "sources": r["sources"], "gate": r["gate"], "generator": r["generator"],
        "approved_by": r["approved_by_name"], "approved_at": r["approved_at"].isoformat() if r["approved_at"] else None,
        "share": share_info, "history": history, "created_at": r["created_at"].isoformat(),
    }


def edit_report(conn, user, report: dict, opinion: str, to_check: list[str] | None) -> None:
    if report["state"] in ("approved", "shared"):
        raise drafting.DomainError("승인한 자료는 고칠 수 없습니다.", 409)
    to_check = report["to_check"] if to_check is None else [t.strip() for t in to_check if t.strip()]
    if opinion.strip() == report["opinion"].strip() and to_check == report["to_check"]:
        return
    v = conn.execute("UPDATE reports SET version = version + 1 WHERE id = %s RETURNING version", (report["id"],)).fetchone()["version"]
    conn.execute("""INSERT INTO report_versions (report_id, version, opinion, to_check, note, created_by)
                    VALUES (%s, %s, %s, %s, '중개사 수정', %s)""", (report["id"], v, opinion.strip(), Jsonb(to_check), user.id))
    record(conn, tenant_id=user.tenant_id, user_id=user.id, event="report.edited", entity="report", entity_id=report["id"],
           payload={"version": v})


def request_review(conn, user, report: dict) -> None:
    if report["state"] != "draft":
        raise drafting.DomainError("작성 중인 자료만 검토를 요청할 수 있습니다.", 409)
    conn.execute("UPDATE reports SET state = 'review' WHERE id = %s", (report["id"],))
    log_activity(conn, report["customer_id"], user.id, f"{report['title']} 검토 요청")
    record(conn, tenant_id=user.tenant_id, user_id=user.id, event="report.review_requested", entity="report", entity_id=report["id"])


def approve(conn, user, report: dict) -> None:
    if report["state"] != "review":
        raise drafting.DomainError("검토 요청된 자료만 승인할 수 있습니다.", 409)
    if not (user.role == "admin" or user.id == report["agent_id"]):
        raise Forbidden("고객 담당 중개사나 관리자만 승인할 수 있습니다.")
    conn.execute("UPDATE reports SET state = 'approved', approved_by = %s, approved_at = now() WHERE id = %s", (user.id, report["id"]))
    log_activity(conn, report["customer_id"], user.id, f"{report['title']} 1.0 승인")
    record(conn, tenant_id=user.tenant_id, user_id=user.id, event="report.approved", entity="report", entity_id=report["id"],
           payload={"draft_version": report["version"], "to_check": len(report["to_check"])})


def share(conn, user, report: dict) -> None:
    if report["state"] not in ("approved", "shared"):
        raise drafting.DomainError("승인한 자료만 고객에게 보낼 수 있습니다.", 409)
    if report["share"] and datetime.fromisoformat(report["share"]["expires_at"]) > datetime.now(timezone.utc):
        return  # 유효한 링크가 이미 있으면 그대로 쓴다
    conn.execute("""UPDATE reports SET state = 'shared', share_token = %s, share_expires_at = now() + %s, share_views = 0,
                    share_last_view = NULL WHERE id = %s""",
                 (secrets.token_urlsafe(9), timedelta(days=SHARE_DAYS), report["id"]))
    log_activity(conn, report["customer_id"], user.id, f"{report['title']} 링크 전달 ({SHARE_DAYS}일 유효)")
    record(conn, tenant_id=user.tenant_id, user_id=user.id, event="report.shared", entity="report", entity_id=report["id"])


def open_shared(conn, token: str) -> tuple[dict, str] | None:
    """공개 링크 열람: 만료·미승인이면 None. 열람 수를 올리고 상담 기록에 남긴다."""
    r = conn.execute(
        """UPDATE reports SET share_views = share_views + 1, share_last_view = now()
           WHERE share_token = %s AND share_expires_at > now() AND state = 'shared'
           RETURNING id, tenant_id, customer_id, title""", (token,)).fetchone()
    if not r:
        return None
    log_activity(conn, r["customer_id"], None, f"고객이 {r['title']} 링크를 열람")
    office = conn.execute("SELECT name FROM tenants WHERE id = %s", (r["tenant_id"],)).fetchone()["name"]
    return load_report(conn, r["tenant_id"], r["id"]), office


# ---------- 인쇄용 HTML ----------

def render_html(report: dict, office: str, *, print_on_load: bool) -> str:
    e = html.escape
    order: list[str] = []
    src = {s["id"]: s for s in report["sources"]}

    def notes(text: str) -> str:
        def sub(m):
            sid = m.group(1)
            if sid not in src:
                return ""
            if sid not in order:
                order.append(sid)
            return f"<sup>{order.index(sid) + 1})</sup>"
        return re.sub(r"\[([cltrkbs]\d+)\]", sub, e(text))

    def cell_trade(l):
        t = l.get("trade_reference")
        return f"{drafting.eok(t['median_price'])} ({t['count']}건)" if t else "자료 없음"

    def cell_fit(l):
        bad = [c["condition"] + " 차이" for c in l.get("checks", []) if not c["ok"]]
        return e(", ".join(bad)) if bad else "맞음"

    table = ""
    if report["listings"]:
        ls = report["listings"]
        rows = [("매도 희망가", lambda l: drafting.eok(l["price"])),
                ("전용면적 / 층", lambda l: f"{l['area_m2']:g}㎡ / {e(l.get('floor') or '-')}"),
                ("교통", lambda l: e(l.get("station") or "-")
                 + (f" 도보 {l['station_walk_min']}분" if l.get("station_walk_min") is not None else "")),
                ("공원", lambda l: f"도보 {l.get('park_walk_min')}분"),
                ("최근 실거래", cell_trade), ("조건", cell_fit)]
        head = "".join(f"<th>{e(l['label'])} {e(l['title'])}</th>" for l in ls)
        body = "".join(f"<tr><th>{h}</th>{''.join(f'<td>{f(l)}</td>' for l in ls)}</tr>" for h, f in rows)
        table = f"<h2>{'매물 비교' if report['kind'] == 'compare' else '맞는 매물'}</h2><table><thead><tr><th></th>{head}</tr></thead><tbody>{body}</tbody></table>"
    question = f"<h2>문의 내용</h2><p>{e(report['question'])}</p>" if report.get("question") else ""
    opinion = notes(report["opinion"])
    checks = "".join(f"<li>{notes(t)}</li>" for t in report["to_check"])
    foot = "".join(
        f"<li>{e(src[i]['org'])}, 「{e(src[i]['title'])}」 {e(src[i].get('location') or '')} ({e(str(src[i]['date']))})"
        f"{' — 보조 자료' if src[i]['type'] == 'news' else ''}</li>" for i in order)
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(report['title'])} · {e(report['customer_name'])} 고객님</title>
<style>body{{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;max-width:760px;margin:32px auto;padding:0 18px;color:#111;line-height:1.7;font-size:14px}}
header{{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #000;padding-bottom:10px}}h1{{font-size:21px;margin:0}}
h2{{font-size:14px;margin:22px 0 6px;border-left:3px solid #000;padding-left:6px}}table{{width:100%;border-collapse:collapse;font-size:13px}}
th,td{{border:1px solid #9aa1aa;padding:5px 7px;text-align:left;vertical-align:top}}th{{background:#f1f2f4}}.from{{text-align:right;font-size:12.5px}}
ol.f{{font-size:12px;color:#444}}footer{{margin-top:24px;border-top:1px solid #9aa1aa;padding-top:8px;font-size:12px;color:#444}}
@media print{{body{{margin:0}}}}</style></head><body>
<header><div><h1>{e(report['title'])}</h1><div>{e(report['customer_name'])} 고객님께 · 제{e(report['version'])}판</div></div>
<div class="from">{e(office)}<br>공인중개사 {e(report['agent_name'])}</div></header>
{question}{table}<h2>{'답변' if report['kind'] == 'answer' else '중개사 의견'}</h2><p>{opinion}</p>
{f'<h2>추가로 확인할 사항</h2><ul>{checks}</ul>' if checks else ''}
<h2>출처</h2><ol class="f">{foot}</ol>
<footer>공인중개사 {e(report['approved_by'] or '')} 확인 · 실거래가는 과거 신고 가격이며 현재 매도 희망가와 다를 수 있습니다.</footer>
{'<script>addEventListener("load",()=>print())</script>' if print_on_load else ''}</body></html>"""
