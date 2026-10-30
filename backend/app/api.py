import html
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from . import drafting, llm, public_data, rag
from .audit import record
from .db import fetch_one, pool, tx
from .security import CurrentUser, create_token, current_user, require_admin, verify_password

router = APIRouter(prefix="/api")


# ---------- 스키마 ----------

class LoginIn(BaseModel):
    email: str
    password: str


class Conditions(BaseModel):
    budget_max: int | None = Field(None, ge=0, description="만원")
    area_min: float | None = Field(None, ge=0)
    district: str | None = None
    station_walk_max: int | None = Field(None, ge=0)
    preferences: list[str] = []


class CandidateIn(BaseModel):
    status: Literal["interest", "excluded", "compare", "none"]
    reason: str | None = None


class ListingIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    complex_name: str = Field(..., min_length=1, max_length=100)
    address: str = Field(..., min_length=2, max_length=200)
    district: str = Field(..., min_length=1, max_length=30)
    price: int = Field(..., gt=0, description="만원")
    area_m2: float = Field(..., gt=0, lt=1000)
    lat: float = Field(..., ge=33, le=39, description="대한민국 범위")
    lng: float = Field(..., ge=124, le=132)
    floor: str | None = Field(None, max_length=20)
    station: str | None = Field(None, max_length=50)
    station_walk_min: int | None = Field(None, ge=0, le=180)
    park_walk_min: int | None = Field(None, ge=0, le=180)
    description: str | None = Field(None, max_length=2000)

    def clean(self) -> dict:
        data = self.model_dump()
        for k, v in data.items():
            if isinstance(v, str):
                data[k] = v.strip() or None
        return data


class CompareIn(BaseModel):
    consultation_id: int
    listing_ids: list[int] = Field(..., min_length=1, max_length=5)


class AskIn(BaseModel):
    consultation_id: int
    question: str = Field(..., min_length=2, max_length=1000)
    as_of: date | None = None


class AdviseIn(BaseModel):
    consultation_id: int
    listing_ids: list[int] | None = None


class DraftEditIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000)
    note: str | None = None


class ApproveIn(BaseModel):
    confirm: bool


class TradeCollectIn(BaseModel):
    lawd_cd: str = Field(..., pattern=r"^\d{5}$")
    deal_ymd: str = Field(..., pattern=r"^\d{6}$")


# ---------- 공통 ----------

def _consultation_row(conn, tenant_id: int, cid: int) -> dict:
    row = conn.execute(
        """SELECT id, customer_name, deal_type, created_at, budget_max, area_min::float AS area_min, district,
                  station_walk_max, preferences FROM consultations WHERE id = %s AND tenant_id = %s""",
        (cid, tenant_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, "상담을 찾을 수 없습니다.")  # 다른 사무소 상담의 존재 여부도 노출하지 않음
    return row


def _conditions(row: dict) -> dict:
    return {k: row[k] for k in ("budget_max", "area_min", "district", "station_walk_max", "preferences")}


def _consultation_detail(conn, tenant_id: int, cid: int) -> dict:
    row = _consultation_row(conn, tenant_id, cid)
    cands = conn.execute("SELECT listing_id, status, reason FROM consultation_candidates WHERE consultation_id = %s",
                         (cid,)).fetchall()
    listings = {l["id"]: l for l in drafting.fetch_listings(conn, tenant_id, ids=[c["listing_id"] for c in cands])} if cands else {}
    logs = conn.execute("SELECT note, at FROM consultation_logs WHERE consultation_id = %s ORDER BY at DESC", (cid,)).fetchall()
    return {
        "id": row["id"], "customer_name": row["customer_name"], "deal_type": row["deal_type"],
        "created_at": row["created_at"].isoformat(), "conditions": _conditions(row),
        "candidates": [{**c, "listing": listings.get(c["listing_id"])} for c in cands],
        "history": [{"at": l["at"].isoformat(), "note": l["note"]} for l in logs],
    }


def _draft_or_404(conn, user: CurrentUser, draft_id: int) -> dict:
    d = drafting.load_draft(conn, user.tenant_id, draft_id)
    if not d:
        raise HTTPException(404, "초안을 찾을 수 없습니다.")
    return d


def _domain(fn, *args):
    try:
        return fn(*args)
    except drafting.DomainError as e:
        raise HTTPException(e.status, str(e))
    except llm.LLMUnavailable as e:
        raise HTTPException(503, f"AI 초안 생성이 일시 중단되었습니다: {e}. 매물 비교와 근거 목록은 계속 사용할 수 있습니다.")


# ---------- 인증 ----------

@router.post("/auth/login")
def login(body: LoginIn):
    row = fetch_one(
        """SELECT u.id, u.tenant_id, t.name AS tenant_name, u.name, u.email, u.role, u.password_hash
           FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.email = %s""",
        (body.email.strip().lower(),),
    )
    if not row or not verify_password(body.password, row.pop("password_hash")):
        raise HTTPException(401, "이메일 또는 비밀번호가 올바르지 않습니다.")
    user = CurrentUser(**row)
    with tx() as conn:
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="auth.login", entity="user", entity_id=user.id)
    return {"access_token": create_token(user.id), "token_type": "bearer", "user": user.public()}


@router.get("/me")
def me(user: CurrentUser = Depends(current_user)):
    return user.public()


# ---------- 상담 ----------

@router.get("/consultations")
def list_consultations(user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT c.id, c.customer_name, c.deal_type, c.created_at, c.budget_max, c.area_min::float AS area_min,
                      c.district, c.station_walk_max, c.preferences,
                      (SELECT count(*) FROM consultation_candidates x WHERE x.consultation_id = c.id AND x.status = 'interest') AS interest,
                      (SELECT count(*) FROM consultation_candidates x WHERE x.consultation_id = c.id AND x.status = 'excluded') AS excluded,
                      (SELECT count(*) FROM consultation_logs x WHERE x.consultation_id = c.id) AS history
               FROM consultations c WHERE c.tenant_id = %s ORDER BY c.created_at DESC""",
            (user.tenant_id,),
        ).fetchall()
    return [{"id": r["id"], "customer_name": r["customer_name"], "deal_type": r["deal_type"],
             "created_at": r["created_at"].isoformat(), "conditions": _conditions(r),
             "counts": {"interest": r["interest"], "excluded": r["excluded"], "history": r["history"]}} for r in rows]


@router.get("/consultations/{cid}")
def get_consultation(cid: int, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        return _consultation_detail(conn, user.tenant_id, cid)


@router.put("/consultations/{cid}/conditions")
def update_conditions(cid: int, body: Conditions, user: CurrentUser = Depends(current_user)):
    prefs = [p.strip() for p in body.preferences if p.strip()]
    with tx() as conn:
        _consultation_row(conn, user.tenant_id, cid)
        conn.execute(
            """UPDATE consultations SET budget_max=%s, area_min=%s, district=%s, station_walk_max=%s, preferences=%s
               WHERE id=%s AND tenant_id=%s""",
            (body.budget_max, body.area_min, body.district or None, body.station_walk_max, prefs, cid, user.tenant_id),
        )
        conn.execute("INSERT INTO consultation_logs (consultation_id, note) VALUES (%s, %s)", (cid, "고객 조건 수정"))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="consultation.conditions_updated",
               entity="consultation", entity_id=cid)
        cond = {**body.model_dump(), "preferences": prefs}
        warnings = drafting.condition_warnings(conn, user.tenant_id, cond)
        return {"consultation": _consultation_detail(conn, user.tenant_id, cid), "warnings": warnings}


@router.put("/consultations/{cid}/candidates/{listing_id}")
def set_candidate(cid: int, listing_id: int, body: CandidateIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        _consultation_row(conn, user.tenant_id, cid)
        if not drafting.fetch_listings(conn, user.tenant_id, ids=[listing_id]):
            raise HTTPException(404, "매물을 찾을 수 없습니다.")
        if body.status == "none":
            conn.execute("DELETE FROM consultation_candidates WHERE consultation_id=%s AND listing_id=%s", (cid, listing_id))
        else:
            conn.execute(
                """INSERT INTO consultation_candidates (consultation_id, listing_id, status, reason) VALUES (%s,%s,%s,%s)
                   ON CONFLICT (consultation_id, listing_id) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason""",
                (cid, listing_id, body.status, body.reason),
            )
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="consultation.candidate_set",
               entity="consultation", entity_id=cid, payload={"listing_id": listing_id, "status": body.status})
        return _consultation_detail(conn, user.tenant_id, cid)


# ---------- 매물·비교 ----------

@router.get("/listings")
def list_listings(district: str | None = None, max_price: int | None = None, min_area: float | None = None,
                  max_station_walk: int | None = None, sort: Literal["price", "recent"] = "price",
                  mine: bool = False, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        items = drafting.fetch_listings(conn, user.tenant_id, district=district or None, max_price=max_price,
                                        min_area=min_area, max_station_walk=max_station_walk, sort=sort,
                                        user_id=user.id, mine=mine)
    as_of = max((i["source_date"] for i in items), default=None)
    return {"items": items, "total": len(items), "as_of": as_of}


def _listing_or_404(conn, user: CurrentUser, listing_id: int, include_closed: bool = False) -> dict:
    found = drafting.fetch_listings(conn, user.tenant_id, ids=[listing_id], user_id=user.id, include_closed=include_closed)
    if not found:
        raise HTTPException(404, "매물을 찾을 수 없습니다.")
    return found[0]


@router.get("/listings/{listing_id}")
def get_listing(listing_id: int, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        listing = _listing_or_404(conn, user, listing_id)
        candidates = conn.execute(
            """SELECT c.id AS consultation_id, c.customer_name, x.status, x.reason
               FROM consultation_candidates x JOIN consultations c ON c.id = x.consultation_id
               WHERE x.listing_id = %s AND c.tenant_id = %s ORDER BY c.id""",
            (listing_id, user.tenant_id),
        ).fetchall()
        return {"listing": listing, "trade_reference": drafting.trade_reference(conn, listing), "candidates": candidates}


@router.post("/listings", status_code=201)
def create_listing(body: ListingIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        row = conn.execute(
            """INSERT INTO listings (tenant_id, label, title, complex_name, address, district, price, area_m2, floor, station,
                                     station_walk_min, park_walk_min, lat, lng, description, source, source_date, registered_by)
               VALUES (%(tenant)s, %(label)s, %(title)s, %(complex_name)s, %(address)s, %(district)s, %(price)s, %(area_m2)s,
                       %(floor)s, %(station)s, %(station_walk_min)s, %(park_walk_min)s, %(lat)s, %(lng)s, %(description)s,
                       '중개사 직접 등록', current_date, %(user)s) RETURNING id""",
            {**body.clean(), "tenant": user.tenant_id, "label": drafting.next_label(conn, user.tenant_id), "user": user.id},
        ).fetchone()
        conn.execute("INSERT INTO listing_price_history (listing_id, price, changed_at) VALUES (%s, %s, current_date)",
                     (row["id"], body.price))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.created", entity="listing", entity_id=row["id"])
        return _listing_or_404(conn, user, row["id"])


@router.put("/listings/{listing_id}")
def update_listing(listing_id: int, body: ListingIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        before = _listing_or_404(conn, user, listing_id)
        conn.execute(
            """UPDATE listings SET title=%(title)s, complex_name=%(complex_name)s, address=%(address)s, district=%(district)s,
                      price=%(price)s, area_m2=%(area_m2)s, floor=%(floor)s, station=%(station)s,
                      station_walk_min=%(station_walk_min)s, park_walk_min=%(park_walk_min)s, lat=%(lat)s, lng=%(lng)s,
                      description=%(description)s, source_date=current_date
               WHERE id=%(id)s AND tenant_id=%(tenant)s""",
            {**body.clean(), "id": listing_id, "tenant": user.tenant_id},
        )
        if body.price != before["price"]:
            conn.execute("INSERT INTO listing_price_history (listing_id, price, changed_at) VALUES (%s, %s, current_date)",
                         (listing_id, body.price))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.updated", entity="listing", entity_id=listing_id,
               payload={"price_changed": body.price != before["price"]})
        return _listing_or_404(conn, user, listing_id)


@router.post("/listings/{listing_id}/close")
def close_listing(listing_id: int, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        _listing_or_404(conn, user, listing_id)
        conn.execute("UPDATE listings SET status = 'closed' WHERE id = %s AND tenant_id = %s", (listing_id, user.tenant_id))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.closed", entity="listing", entity_id=listing_id)
        return _listing_or_404(conn, user, listing_id, include_closed=True)


@router.post("/compare")
def compare(body: CompareIn, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        cond = _conditions(_consultation_row(conn, user.tenant_id, body.consultation_id))
        listings = drafting.fetch_listings(conn, user.tenant_id, ids=body.listing_ids)
        if len(listings) != len(set(body.listing_ids)):
            raise HTTPException(404, "선택한 매물 중 조회할 수 없는 항목이 있습니다.")
        order = {lid: i for i, lid in enumerate(body.listing_ids)}
        listings.sort(key=lambda l: order[l["id"]])
        return {"rows": [{"listing": l, "checks": drafting.condition_checks(l, cond),
                          "trade_reference": drafting.trade_reference(conn, l)} for l in listings]}


# ---------- 근거 검색 ----------

@router.get("/evidence/search")
def evidence_search(q: str = Query(..., min_length=1), region: str | None = None,
                    user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        hits = rag.search(conn, user.tenant_id, q, region=region or None, k=8)
        gate = rag.evidence_gate(hits, as_of=date.today(), policy_question=rag.is_policy_question(q))
    return {"items": list(gate["evidence"].values()), "gate": {"status": gate["status"], "messages": gate["messages"]}}


@router.get("/evidence/{chunk_id}")
def evidence_detail(chunk_id: str, user: CurrentUser = Depends(current_user)):
    raw = chunk_id[1:] if chunk_id.startswith("c") else chunk_id
    if not raw.isdigit():
        raise HTTPException(404, "근거를 찾을 수 없습니다.")
    row = fetch_one(
        """SELECT c.id, c.document_id, c.location, c.text, d.title, d.publisher, d.source_type, d.published_at,
                  d.effective_date, d.url, 0.0 AS score
           FROM chunks c JOIN documents d ON d.id = c.document_id
           WHERE c.id = %s AND (c.tenant_id IS NULL OR c.tenant_id = %s)""",
        (int(raw), user.tenant_id),
    )
    if not row:
        raise HTTPException(404, "근거를 찾을 수 없습니다.")
    return rag.to_evidence(row)


# ---------- AI 초안 ----------

@router.post("/ask")
def ask(body: AskIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        c = _consultation_row(conn, user.tenant_id, body.consultation_id)
        draft_id = _domain(drafting.run_ask, conn, user, c, body.question.strip(), body.as_of)
        return drafting.load_draft(conn, user.tenant_id, draft_id)


@router.post("/advise")
def advise(body: AdviseIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        c = _consultation_row(conn, user.tenant_id, body.consultation_id)
        draft_id = _domain(drafting.run_advise, conn, user, c, body.listing_ids)
        return drafting.load_draft(conn, user.tenant_id, draft_id)


@router.get("/drafts")
def list_drafts(consultation_id: int | None = None, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT id, mode, consultation_id, question, state, version, generator, created_at, gate->>'status' AS gate_status
               FROM drafts WHERE tenant_id = %s AND (%s::int IS NULL OR consultation_id = %s) ORDER BY created_at DESC""",
            (user.tenant_id, consultation_id, consultation_id),
        ).fetchall()
    return [{**r, "created_at": r["created_at"].isoformat(),
             "version_label": drafting.version_label(r["state"], r["version"])} for r in rows]


@router.get("/drafts/{draft_id}")
def get_draft(draft_id: int, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        return _draft_or_404(conn, user, draft_id)


@router.put("/drafts/{draft_id}")
def edit_draft(draft_id: int, body: DraftEditIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        d = _draft_or_404(conn, user, draft_id)
        if d["state"] == "approved":
            raise HTTPException(409, "승인된 초안은 수정할 수 없습니다.")
        text = body.text.strip()
        if text == d["text"].strip():
            return d
        new_version = d["version"] + 1
        conn.execute("UPDATE drafts SET version = %s WHERE id = %s", (new_version, draft_id))
        conn.execute("INSERT INTO draft_versions (draft_id, version, text, note, created_by) VALUES (%s,%s,%s,%s,%s)",
                     (draft_id, new_version, text, body.note or "중개사 수정 저장", user.id))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="draft.edited", entity="draft",
               entity_id=draft_id, payload={"version": new_version})
        return drafting.load_draft(conn, user.tenant_id, draft_id)


@router.post("/drafts/{draft_id}/review")
def start_review(draft_id: int, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        d = _draft_or_404(conn, user, draft_id)
        if d["state"] != "draft":
            raise HTTPException(409, "AI 초안 상태에서만 검토를 시작할 수 있습니다.")
        conn.execute("UPDATE drafts SET state = 'review' WHERE id = %s", (draft_id,))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="draft.review_started", entity="draft",
               entity_id=draft_id, payload={"version": d["version"]})
        return drafting.load_draft(conn, user.tenant_id, draft_id)


@router.post("/drafts/{draft_id}/approve")
def approve(draft_id: int, body: ApproveIn, user: CurrentUser = Depends(current_user)):
    if not body.confirm:
        raise HTTPException(400, "출처·기준일·확인 불가 항목 검토 확인이 필요합니다.")
    with tx() as conn:
        d = _draft_or_404(conn, user, draft_id)
        if d["state"] != "review":
            raise HTTPException(409, "검토 중인 초안만 승인할 수 있습니다.")
        conn.execute("UPDATE drafts SET state = 'approved', approved_by = %s, approved_at = now() WHERE id = %s",
                     (user.id, draft_id))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="draft.approved", entity="draft",
               entity_id=draft_id, payload={"version": d["version"],
                                            "unverifiable": sum(1 for c in d["claims"] if c["status"] == "unverifiable")})
        return drafting.load_draft(conn, user.tenant_id, draft_id)


@router.get("/drafts/{draft_id}/export", response_class=HTMLResponse)
def export_draft(draft_id: int, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        d = _draft_or_404(conn, user, draft_id)
        if d["state"] != "approved":
            raise HTTPException(409, "승인본만 인쇄·복사할 수 있습니다.")
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="draft.exported", entity="draft", entity_id=draft_id)
    e = html.escape
    lines = "".join(f"<p>{e(line)}</p>" for line in d["text"].splitlines() if line.strip())
    sources = "".join(
        f"<li><b>{e(ev['title'])}</b> · {e(ev['publisher'] or '')} · 기준일 {e(str(ev['date']))} · {e(ev['location'] or '')}</li>"
        for ev in d["evidence"])
    title = "정책 답변" if d["mode"] == "ask" else "상담자료"
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>중개메이트 {title} {e(d['version_label'])}</title>
<style>body{{font-family:system-ui,'Malgun Gothic',sans-serif;max-width:760px;margin:40px auto;line-height:1.7;color:#1d2a26}}
h1{{font-size:22px}}.meta{{color:#555;font-size:14px}}ol{{font-size:13px;color:#444}}</style></head>
<body><h1>중개메이트 {title} {e(d['version_label'])}</h1>
<p class="meta">승인자 {e(d['approved_by'] or '')} · 승인 시각 {e(d['approved_at'] or '')}{(' · 질문: ' + e(d['question'])) if d['question'] else ''}</p>
{lines}<h2>근거 출처</h2><ol>{sources}</ol>
<p class="meta">이 자료는 공인중개사가 출처·기준일을 검토하고 승인한 버전입니다. 확인 불가 항목은 추가 확인이 필요합니다.</p>
<script>window.addEventListener('load',()=>window.print())</script></body></html>"""


# ---------- 운영 ----------

@router.get("/health")
def health():
    status = {"status": "ok", "db": "ok", "vector": "ok",
              "llm": f"anthropic:{llm.settings.llm_model}" if llm.is_enabled() else "disabled (규칙 기반 초안)"}
    try:
        row = fetch_one("SELECT count(*) AS n FROM pg_extension WHERE extname = 'vector'")
        status["vector"] = "ok" if row and row["n"] else "missing"
    except Exception as e:  # noqa: BLE001 - 상태 보고용
        status.update(status="degraded", db=f"error: {type(e).__name__}", vector="unknown")
    return status


@router.post("/admin/documents")
async def upload_document(file: UploadFile = File(...), title: str = Form(...),
                          source_type: Literal["law", "policy", "office", "news"] = Form(...),
                          publisher: str = Form(...), published_at: date = Form(...),
                          effective_date: date | None = Form(None), region: str | None = Form(None),
                          url: str | None = Form(None), license: str | None = Form(None),
                          scope: Literal["public", "tenant"] = Form("tenant"),
                          user: CurrentUser = Depends(require_admin)):
    raw = await file.read()
    ext = (file.filename or "doc.txt").rsplit(".", 1)[-1].lower()
    tenant_id = None if scope == "public" else user.tenant_id
    with tx() as conn:
        job = conn.execute("INSERT INTO ingest_jobs (tenant_id, kind, status, detail) VALUES (%s,'document','running',%s) RETURNING id",
                           (user.tenant_id, title)).fetchone()
    try:
        if ext == "pdf":
            import fitz  # PyMuPDF

            from .chunking import pages_to_text
            with fitz.open(stream=raw, filetype="pdf") as pdf:
                text = pages_to_text([page.get_text() for page in pdf])
        else:
            text = raw.decode("utf-8")
        if not text.strip():
            raise ValueError("텍스트를 추출하지 못했습니다(스캔 문서는 OCR 필요).")
        with tx() as conn:
            doc_id, created = rag.ingest_document(
                conn, tenant_id=tenant_id, source_type=source_type, title=title, publisher=publisher,
                published_at=published_at, effective_date=effective_date, region=region or None, url=url or None,
                license=license, text=text, raw=raw, ext=ext)
            conn.execute("UPDATE ingest_jobs SET status='done', detail=%s, finished_at=now() WHERE id=%s",
                         (f"문서 #{doc_id} {'신규' if created else '중복(기존 유지)'}", job["id"]))
            record(conn, tenant_id=user.tenant_id, user_id=user.id, event="document.ingested", entity="document",
                   entity_id=doc_id, payload={"scope": scope, "created": created})
    except (ValueError, UnicodeDecodeError) as e:
        with tx() as conn:
            conn.execute("UPDATE ingest_jobs SET status='failed', detail=%s, finished_at=now() WHERE id=%s", (str(e), job["id"]))
        raise HTTPException(422, f"문서 처리 실패: {e}")
    return {"job": fetch_one("SELECT * FROM ingest_jobs WHERE id = %s", (job["id"],))}


@router.get("/admin/jobs")
def list_jobs(user: CurrentUser = Depends(require_admin)):
    with pool.connection() as conn:
        return conn.execute("SELECT * FROM ingest_jobs WHERE tenant_id = %s OR tenant_id IS NULL ORDER BY id DESC LIMIT 50",
                            (user.tenant_id,)).fetchall()


@router.get("/admin/documents")
def list_documents(user: CurrentUser = Depends(require_admin)):
    with pool.connection() as conn:
        return conn.execute(
            """SELECT d.id, d.tenant_id, d.source_type, d.title, d.publisher, d.published_at, d.effective_date, d.region,
                      d.embed_model, (SELECT count(*) FROM chunks c WHERE c.document_id = d.id) AS chunks
               FROM documents d WHERE d.tenant_id IS NULL OR d.tenant_id = %s ORDER BY d.id""", (user.tenant_id,)).fetchall()


@router.delete("/admin/documents/{doc_id}")
def delete_document(doc_id: int, user: CurrentUser = Depends(require_admin)):
    with tx() as conn:
        doc = conn.execute("SELECT id, tenant_id, raw_path FROM documents WHERE id = %s AND tenant_id = %s",
                           (doc_id, user.tenant_id)).fetchone()
        if not doc:
            raise HTTPException(404, "이 사무소 문서가 아니거나 존재하지 않습니다. (공용 문서는 운영자가 관리)")
        conn.execute("DELETE FROM documents WHERE id = %s", (doc_id,))  # chunks는 ON DELETE CASCADE로 전파
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="document.deleted", entity="document", entity_id=doc_id)
    if doc["raw_path"]:
        try:
            from pathlib import Path
            Path(doc["raw_path"]).unlink(missing_ok=True)
        except OSError:
            pass
    return {"deleted": doc_id}


@router.post("/admin/collect/trades")
def collect_trades(body: TradeCollectIn, user: CurrentUser = Depends(require_admin)):
    with tx() as conn:
        job = conn.execute("INSERT INTO ingest_jobs (tenant_id, kind, status, detail) VALUES (%s,'trades','running',%s) RETURNING id",
                           (user.tenant_id, f"{body.lawd_cd}/{body.deal_ymd}")).fetchone()
    try:
        rows = public_data.fetch_trades(body.lawd_cd, body.deal_ymd)
    except public_data.ExternalUnavailable as e:
        with tx() as conn:
            conn.execute("UPDATE ingest_jobs SET status='failed', detail=%s, finished_at=now() WHERE id=%s", (str(e), job["id"]))
        raise HTTPException(503, str(e))
    with tx() as conn:
        n = public_data.store_trades(conn, rows)
        conn.execute("UPDATE ingest_jobs SET status='done', detail=%s, finished_at=now() WHERE id=%s",
                     (f"{len(rows)}건 수신, {n}건 신규 저장", job["id"]))
    return {"received": len(rows), "inserted": n}


@router.get("/audit")
def audit_events(entity_id: int | None = None, user: CurrentUser = Depends(require_admin)):
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT a.id, a.event, a.entity, a.entity_id, a.payload, a.request_id, a.created_at, u.name AS user_name
               FROM audit_events a LEFT JOIN users u ON u.id = a.user_id
               WHERE a.tenant_id = %s AND (%s::int IS NULL OR a.entity_id = %s) ORDER BY a.id DESC LIMIT 200""",
            (user.tenant_id, entity_id, entity_id),
        ).fetchall()
    return [{**r, "created_at": r["created_at"].isoformat()} for r in rows]
