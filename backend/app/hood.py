"""Hood AI: 질문 대화(세션) 저장, 이어 묻기, 사무소 설정, 사용량, 보고서 목록.

질문 하나는 assistant.answer가 답한다. 여기서는 그 답을 대화에 쌓고, 설정을 적용하고, 사용량을 기록에서 계산한다.
날짜는 한국 시간(Asia/Seoul) 기준으로 센다.
"""
from datetime import timedelta

from . import assistant, drafting
from .db import Jsonb

SOURCE_TYPES = ("law", "policy", "office", "news")
FOLLOW_WORDS = ("그중", "그 중", "이중", "이 중", "거기서", "여기서", "그럼", "그러면", "추가로")
KST_DATE = "(m.created_at AT TIME ZONE 'Asia/Seoul')::date"


class LimitReached(RuntimeError):
    pass


# ---------- 설정 ----------

def get_settings(conn, tenant_id: int) -> dict:
    row = conn.execute(
        """SELECT s.source_types, s.detail_count, s.near_miss, s.monthly_limit, s.updated_at, u.name AS updated_by
           FROM ai_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.tenant_id = %s""", (tenant_id,)).fetchone()
    if not row:
        return {**assistant.DEFAULT_SETTINGS, "monthly_limit": None, "updated_at": None, "updated_by": None}
    return {**row, "source_types": list(row["source_types"]), "updated_at": row["updated_at"].isoformat()}


def save_settings(conn, user, data: dict) -> dict:
    types = [t for t in SOURCE_TYPES if t in (data.get("source_types") or [])]
    if not types:
        raise drafting.DomainError("답변에 쓸 자료를 하나 이상 골라 주세요.")
    conn.execute(
        """INSERT INTO ai_settings (tenant_id, source_types, detail_count, near_miss, monthly_limit, updated_by, updated_at)
           VALUES (%s,%s,%s,%s,%s,%s, now())
           ON CONFLICT (tenant_id) DO UPDATE SET source_types = EXCLUDED.source_types, detail_count = EXCLUDED.detail_count,
             near_miss = EXCLUDED.near_miss, monthly_limit = EXCLUDED.monthly_limit, updated_by = EXCLUDED.updated_by,
             updated_at = now()""",
        (user.tenant_id, types, data["detail_count"], data["near_miss"], data.get("monthly_limit"), user.id))
    return get_settings(conn, user.tenant_id)


def month_count(conn, tenant_id: int) -> int:
    return conn.execute(
        f"""SELECT count(*)::int AS n FROM ai_messages m JOIN ai_sessions s ON s.id = m.session_id
            WHERE s.tenant_id = %s AND {KST_DATE} >= date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul'))::date""",
        (tenant_id,)).fetchone()["n"]


# ---------- 대화 ----------

def _session(conn, user, session_id: int) -> dict:
    s = conn.execute("SELECT * FROM ai_sessions WHERE id = %s AND user_id = %s AND tenant_id = %s",
                     (session_id, user.id, user.tenant_id)).fetchone()
    if not s:
        raise drafting.DomainError("대화를 찾을 수 없습니다.", 404)
    return s


def _follow_up(q: str) -> str | None:
    """'그중 7억 이하만' → '7억 이하만' (이어 묻기면 앞말을 뗀 나머지, 아니면 None)"""
    for w in FOLLOW_WORDS:
        if q.startswith(w):
            return q[len(w):].lstrip(" ,에서는")
    return None


def ask(conn, user, q: str, *, drop: list[str] | None = None, session_id: int | None = None) -> dict:
    """질문 하나: 한도 확인 → 대화 불러오기·이어 묻기 → 답변 → 대화에 저장."""
    settings = get_settings(conn, user.tenant_id)
    if settings["monthly_limit"] and month_count(conn, user.tenant_id) >= settings["monthly_limit"]:
        raise LimitReached(f"이번 달 질문 한도({settings['monthly_limit']}건)를 모두 썼습니다. "
                           "관리자가 Hood AI 설정에서 한도를 바꿀 수 있습니다.")
    q = q.strip()
    session = _session(conn, user, session_id) if session_id else None
    last = conn.execute("SELECT * FROM ai_messages WHERE session_id = %s ORDER BY id DESC LIMIT 1",
                        (session["id"],)).fetchone() if session else None
    effective = q
    if last and (rest := _follow_up(q)) is not None:
        effective = f"{last['effective_query']} {rest}".strip()
    result = assistant.answer(conn, user, effective, dropped=drop or [], settings=settings)

    if not session:
        session = conn.execute("INSERT INTO ai_sessions (tenant_id, user_id, title) VALUES (%s,%s,%s) RETURNING *",
                               (user.tenant_id, user.id, q[:60])).fetchone()
    if last and last["question"] == q and list(last["dropped"]) != list(drop or []):
        # 같은 질문에서 조건만 뺀 다시 찾기는 새 질문으로 쌓지 않고 마지막 답을 바꾼다
        effective = last["effective_query"]
        msg = conn.execute("UPDATE ai_messages SET dropped = %s, result = %s, generator = %s WHERE id = %s RETURNING id, created_at",
                           (drop or [], Jsonb(result), result["generator"], last["id"])).fetchone()
    else:
        msg = conn.execute(
            """INSERT INTO ai_messages (session_id, question, effective_query, dropped, result, generator)
               VALUES (%s,%s,%s,%s,%s,%s) RETURNING id, created_at""",
            (session["id"], q, effective, drop or [], Jsonb(result), result["generator"])).fetchone()
    conn.execute("UPDATE ai_sessions SET updated_at = now() WHERE id = %s", (session["id"],))
    return {**result, "session_id": session["id"], "message_id": msg["id"], "question": q, "effective_query": effective,
            "dropped": drop or [], "asked_at": msg["created_at"].isoformat()}


def list_sessions(conn, user, limit: int = 30) -> list[dict]:
    rows = conn.execute(
        """SELECT s.id, s.title, s.updated_at, count(m.id)::int AS messages,
                  (SELECT question FROM ai_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) AS last_question
           FROM ai_sessions s LEFT JOIN ai_messages m ON m.session_id = s.id
           WHERE s.user_id = %s AND s.tenant_id = %s GROUP BY s.id ORDER BY s.updated_at DESC LIMIT %s""",
        (user.id, user.tenant_id, limit)).fetchall()
    return [{**r, "updated_at": r["updated_at"].isoformat()} for r in rows]


def get_session(conn, user, session_id: int) -> dict:
    s = _session(conn, user, session_id)
    msgs = conn.execute("SELECT id, question, effective_query, dropped, result, created_at FROM ai_messages "
                        "WHERE session_id = %s ORDER BY id", (session_id,)).fetchall()
    return {"id": s["id"], "title": s["title"], "updated_at": s["updated_at"].isoformat(),
            "messages": [{**m["result"], "session_id": s["id"], "message_id": m["id"], "question": m["question"],
                          "effective_query": m["effective_query"], "dropped": list(m["dropped"]),
                          "asked_at": m["created_at"].isoformat()} for m in msgs]}


def delete_session(conn, user, session_id: int) -> None:
    _session(conn, user, session_id)
    conn.execute("DELETE FROM ai_sessions WHERE id = %s", (session_id,))


# ---------- 사용량 ----------

def usage(conn, user, days: int = 14) -> dict:
    """사무소의 질문 기록에서 계산한다. 합계는 모두 행에서 센 값이다."""
    today = conn.execute("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS d").fetchone()["d"]
    month_start = today.replace(day=1)
    since = min(today - timedelta(days=days - 1), month_start)
    rows = conn.execute(
        f"""SELECT {KST_DATE} AS day, m.generator, s.user_id, u.name AS user_name,
                   jsonb_array_length(m.result->'listings') AS listings,
                   COALESCE((SELECT array_agg(x->>'type') FROM jsonb_array_elements(m.result->'sources') x), '{{}}') AS source_types
            FROM ai_messages m JOIN ai_sessions s ON s.id = m.session_id JOIN users u ON u.id = s.user_id
            WHERE s.tenant_id = %s AND {KST_DATE} >= %s""", (user.tenant_id, since)).fetchall()
    month = [r for r in rows if r["day"] >= month_start]
    daily = [{"date": str(today - timedelta(days=i)), "count": sum(1 for r in rows if r["day"] == today - timedelta(days=i))}
             for i in range(days - 1, -1, -1)]
    by_user: dict[str, int] = {}
    by_type = {t: 0 for t in ("data", *SOURCE_TYPES)}
    for r in month:
        by_user[r["user_name"]] = by_user.get(r["user_name"], 0) + 1
        for t in r["source_types"] or []:
            by_type[t] = by_type.get(t, 0) + 1
    cited = sum(len(r["source_types"] or []) for r in month)
    reports = conn.execute(
        """SELECT count(*)::int AS n FROM reports WHERE tenant_id = %s AND kind = 'answer'
           AND (created_at AT TIME ZONE 'Asia/Seoul')::date >= %s""", (user.tenant_id, month_start)).fetchone()["n"]
    return {
        "today": str(today), "month_start": str(month_start),
        "month_total": len(month), "today_total": sum(1 for r in month if r["day"] == today),
        "mine_month": sum(1 for r in month if r["user_id"] == user.id),
        "with_listings": sum(1 for r in month if r["listings"]),
        "avg_sources": round(cited / len(month), 1) if month else None,
        "reports_from_answers": reports,
        "llm_answers": sum(1 for r in month if r["generator"] == "anthropic"),
        "daily": daily,
        "by_user": sorted(({"name": k, "count": v} for k, v in by_user.items()), key=lambda x: -x["count"]),
        "by_source_type": [{"type": k, "count": v} for k, v in sorted(by_type.items(), key=lambda kv: -kv[1])],
        "monthly_limit": get_settings(conn, user.tenant_id)["monthly_limit"],
    }


# ---------- 보고서 (고객 자료 목록) ----------

def list_reports(conn, tenant_id: int, state: str | None = None) -> list[dict]:
    states = {"draft": ["draft"], "review": ["review"], "done": ["approved", "shared"]}.get(state or "")
    rows = conn.execute(
        """SELECT r.id, r.kind, r.title, r.question, r.state, r.version, r.generator, r.share_views, r.created_at,
                  c.id AS customer_id, c.name AS customer_name, u.name AS created_by
           FROM reports r JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = r.created_by
           WHERE r.tenant_id = %s AND (%s::text[] IS NULL OR r.state = ANY(%s::text[]))
           ORDER BY r.created_at DESC, r.id DESC LIMIT 200""",
        (tenant_id, states, states)).fetchall()
    return [{**r, "created_at": r["created_at"].isoformat()} for r in rows]


def report_counts(conn, tenant_id: int) -> dict:
    rows = conn.execute("SELECT state, count(*)::int AS n FROM reports WHERE tenant_id = %s GROUP BY state", (tenant_id,)).fetchall()
    n = {r["state"]: r["n"] for r in rows}
    return {"all": sum(n.values()), "draft": n.get("draft", 0), "review": n.get("review", 0),
            "done": n.get("approved", 0) + n.get("shared", 0)}
