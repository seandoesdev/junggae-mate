"""REST API (docs/API.md v0.3). tenant는 토큰의 사용자 레코드에서만 정해진다."""
import re
from datetime import date
from pathlib import Path
from typing import Literal

import psycopg
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from . import assistant, drafting, hood, llm, structured, public_catalog, public_data, public_sources, rag, vault, workflow
from .audit import record
from .config import settings
from .db import fetch_one, pool, tx
from .security import CurrentUser, create_token, current_user, hash_password, require_admin, verify_password

router = APIRouter(prefix="/api")
public = APIRouter()


# ---------- 입력 ----------

class LoginIn(BaseModel):
    email: str
    password: str


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class SignupIn(BaseModel):
    """회원가입 = 새 사무소 만들기. 가입한 사람이 그 사무소의 관리자가 된다"""
    office_name: str = Field(min_length=2, max_length=60)
    name: str = Field(min_length=1, max_length=40)
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("office_name", "name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("비워 둘 수 없습니다.")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL.match(v):
            raise ValueError("이메일 형식이 올바르지 않습니다.")
        return v


class _Clean(BaseModel):
    def clean(self) -> dict:
        data = self.model_dump()
        for k, v in data.items():
            if isinstance(v, str):
                data[k] = v.strip() or None
        return data


PropertyType = Literal["apartment", "officetel", "villa", "house", "oneroom", "commercial"]
# 매물 입력 칸 = listings 열 이름 (INSERT·UPDATE에 그대로 쓴다)
LISTING_FIELDS = ("title", "property_type", "complex_name", "address", "district", "price", "jeonse_deposit",
                  "monthly_deposit", "monthly_rent", "area_m2", "supply_m2", "rooms", "baths", "facing", "maintenance_fee",
                  "maintenance_note", "parking", "move_in", "loan_amount", "floor", "station", "station_walk_min",
                  "park_walk_min", "lat", "lng", "description")


class ListingIn(_Clean):
    """금액은 만원. 매매가·전세 보증금·월세(보증금+월세) 중 하나 이상. 한 매물을 여러 거래 종류로 내놓을 수 있다"""
    title: str = Field(..., min_length=1, max_length=100)
    property_type: PropertyType = "apartment"
    complex_name: str | None = Field(None, max_length=100, description="아파트·오피스텔은 필수. 비우면 매물 이름을 쓴다")
    address: str = Field(..., min_length=2, max_length=200)
    district: str = Field(..., min_length=1, max_length=30)
    price: int | None = Field(None, gt=0, description="매매가 (만원)")
    jeonse_deposit: int | None = Field(None, gt=0, description="전세 보증금 (만원)")
    monthly_deposit: int | None = Field(None, ge=0, description="월세 보증금 (만원)")
    monthly_rent: int | None = Field(None, gt=0, le=10000, description="월세 (만원)")
    area_m2: float = Field(..., gt=0, lt=1000, description="전용면적")
    supply_m2: float | None = Field(None, gt=0, lt=2000, description="공급면적")
    rooms: int | None = Field(None, ge=0, le=20)
    baths: int | None = Field(None, ge=0, le=10)
    facing: str | None = Field(None, max_length=10)
    maintenance_fee: int | None = Field(None, ge=0, le=1000, description="월 관리비 (만원)")
    maintenance_note: str | None = Field(None, max_length=200)
    parking: str | None = Field(None, max_length=50)
    move_in: str | None = Field(None, max_length=30)
    loan_amount: int | None = Field(None, ge=0, description="융자 (만원)")
    lat: float = Field(..., ge=33, le=39, description="대한민국 범위")
    lng: float = Field(..., ge=124, le=132)
    floor: str | None = Field(None, max_length=20)
    station: str | None = Field(None, max_length=50)
    station_walk_min: int | None = Field(None, ge=0, le=180)
    park_walk_min: int | None = Field(None, ge=0, le=180)
    description: str | None = Field(None, max_length=2000)

    @model_validator(mode="after")
    def _amounts(self):
        if self.property_type in ("apartment", "officetel") and not (self.complex_name or "").strip():
            raise ValueError("아파트·오피스텔은 단지 이름을 적어 주세요.")
        if (self.monthly_deposit is None) != (self.monthly_rent is None):
            raise ValueError("월세는 보증금과 월세를 함께 적어 주세요.")
        if self.price is None and self.jeonse_deposit is None and self.monthly_rent is None:
            raise ValueError("매매가·전세 보증금·월세 중 하나는 적어 주세요.")
        return self

    def clean(self) -> dict:
        data = super().clean()
        data["complex_name"] = data["complex_name"] or data["title"]
        return data


class CustomerIn(_Clean):
    """phone: 새 번호를 적을 때만 보낸다 (비우면 기존 번호 유지, 지우려면 clear_phone). 저장은 암호문으로만"""
    name: str = Field(..., min_length=1, max_length=50)
    deal_type: str = Field("매수", max_length=20)
    phone: str | None = Field(None, max_length=30)
    clear_phone: bool = False
    budget_max: int | None = Field(None, ge=0, description="만원. 전세·월세 고객은 보증금 한도")
    monthly_rent_max: int | None = Field(None, ge=0, le=10000, description="월세 고객의 월세 한도 (만원)")
    area_min: float | None = Field(None, ge=0)
    district: str | None = Field(None, max_length=30)
    station_walk_max: int | None = Field(None, ge=0, le=180)
    preferences: list[str] = []
    first_home: bool = False
    privacy_consent: bool = Field(False, description="개인정보 수집·이용 동의를 받았는지")

    def clean(self) -> dict:
        data = super().clean()
        data["preferences"] = [p.strip() for p in self.preferences if p.strip()]
        data["deal_type"] = data["deal_type"] or "매수"
        return data


class OwnerIn(_Clean):
    name: str = Field(..., min_length=1, max_length=50)
    phone: str | None = Field(None, max_length=30)
    clear_phone: bool = False
    relation: str = Field("본인", max_length=20)
    memo: str | None = Field(None, max_length=500)
    privacy_consent: bool = False


class MandateIn(_Clean):
    """매물의 의뢰 조건·방문 안내. owner_id(기존 의뢰인) 또는 owner(새 의뢰인) 중 하나.
    tenant_phone·access: 새 값을 적을 때만 보낸다 (비우면 유지, 지우려면 clear_*)"""
    owner_id: int | None = None
    owner: OwnerIn | None = None
    kind: Literal["general", "exclusive"] = "general"
    starts_on: date | None = None
    ends_on: date | None = None
    price_flex: str | None = Field(None, max_length=200)
    move_out: str | None = Field(None, max_length=100)
    occupancy: Literal["vacant", "owner", "tenant"] = "vacant"
    tenant_phone: str | None = Field(None, max_length=30)
    clear_tenant_phone: bool = False
    visit_rule: str | None = Field(None, max_length=300)
    access: str | None = Field(None, max_length=200)
    clear_access: bool = False

    @model_validator(mode="after")
    def _check(self):
        if (self.owner_id is None) == (self.owner is None):
            raise ValueError("의뢰인을 고르거나 새로 적어 주세요.")
        if self.starts_on and self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("의뢰 만료일이 의뢰일보다 빠릅니다.")
        return self


class RevealIn(BaseModel):
    field: Literal["owner_phone", "tenant_phone", "access"]


class UserCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    email: str = Field(..., max_length=254)
    password: str = Field(..., min_length=8, max_length=128)
    role: Literal["agent", "admin"] = "agent"

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL.match(v):
            raise ValueError("이메일 형식이 올바르지 않습니다.")
        return v


class DisableIn(BaseModel):
    transfer_to: int = Field(..., description="고객·매물·진행 중 거래를 넘겨받을 중개사")


class OfficeSettingsIn(BaseModel):
    contact_owner_only: bool


class CheckIn(BaseModel):
    checked: bool


class ActivityIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)


class DealIn(BaseModel):
    listing_id: int
    customer_id: int
    next_action: str | None = Field(None, max_length=200)


class StageIn(BaseModel):
    stage: Literal["intro", "visit", "nego", "contract", "done", "dropped"]
    reason: str | None = Field(None, max_length=200)


class DealEditIn(BaseModel):
    next_action: str | None = Field(None, max_length=200)


class ReportIn(BaseModel):
    kind: Literal["compare", "answer"]
    listing_ids: list[int] | None = None
    question: str | None = Field(None, max_length=1000)
    quote_id: str | None = Field(None, max_length=20)
    drop: list[str] = Field(default_factory=list, max_length=20, description="질문 검색에서 뺀 조건 (문의 답변)")


class ReportEditIn(BaseModel):
    opinion: str = Field(..., min_length=1, max_length=20000)
    to_check: list[str] | None = None


class ApproveIn(BaseModel):
    confirm: bool


class SearchIn(BaseModel):
    q: str = Field(..., min_length=1, max_length=500)
    drop: list[str] = Field(default_factory=list, max_length=20, description="지울 조건 key (예: price, want:학교)")
    session_id: int | None = Field(None, description="이어서 물을 대화. 없으면 새 대화를 만든다")
    exclude_types: list[Literal["law", "policy", "office", "news"]] = Field(
        default_factory=list, description="이번 질문에서만 뺄 문서 유형 (예: 기사 빼고)")


class LinkIn(BaseModel):
    entity_key: str = Field(
        ..., min_length=1, max_length=1000,
        description="complex: kapt_code, building: source_key, station: station_id 또는 station_ids:id1,id2",
    )


class AISettingsIn(BaseModel):
    source_types: list[Literal["law", "policy", "office", "news"]] = Field(..., min_length=1)
    detail_count: int = Field(3, ge=1, le=5)
    near_miss: bool = True
    monthly_limit: int | None = Field(None, ge=1, le=100000)


class NoteIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)


class DocumentIn(_Clean):
    title: str = Field(..., min_length=1, max_length=200)
    text: str = Field(..., min_length=5, max_length=20000)
    region: str | None = Field(None, max_length=30)


class TradeCollectIn(BaseModel):
    lawd_cd: str = Field(..., pattern=r"^\d{5}$")
    deal_ymd: str = Field(..., pattern=r"^\d{6}$")

    @field_validator("deal_ymd")
    @classmethod
    def valid_deal_month(cls, value: str) -> str:
        if not 1 <= int(value[4:]) <= 12:
            raise ValueError("계약월은 YYYYMM 형식이어야 합니다.")
        return value


class KaptCollectIn(BaseModel):
    kapt_code: str = Field(..., min_length=1, max_length=30, pattern=r"^[A-Za-z0-9]+$")


class BuildingCollectIn(BaseModel):
    sigungu_cd: str = Field(..., pattern=r"^\d{5}$")
    bjdong_cd: str = Field(..., pattern=r"^\d{5}$")
    plat_gb_cd: str | None = Field(None, pattern=r"^[0-3]$")
    bun: str | None = Field(None, pattern=r"^\d{1,4}$")
    ji: str | None = Field(None, pattern=r"^\d{1,4}$")


class SubwayCollectIn(BaseModel):
    station_name: str = Field(..., min_length=1, max_length=50)

    @field_validator("station_name")
    @classmethod
    def non_blank_station_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("역명을 입력해 주세요.")
        return value


# ---------- 공통 ----------

def _guard(fn, *args, **kwargs):
    """업무 오류를 HTTP 오류로 바꾼다."""
    try:
        return fn(*args, **kwargs)
    except drafting.DomainError as e:
        raise HTTPException(e.status, str(e))
    except workflow.Forbidden as e:
        raise HTTPException(403, str(e))
    except llm.LLMUnavailable as e:
        raise HTTPException(503, f"문서 초안을 만들지 못했습니다({e}). 매물·고객·거래 기능은 계속 쓸 수 있습니다.")
    except hood.LimitReached as e:
        raise HTTPException(429, str(e))
    except structured.LinkError as e:
        raise HTTPException(422, str(e))


def _listing(conn, user: CurrentUser, listing_id: int, include_closed: bool = False) -> dict:
    found = drafting.fetch_listings(conn, user.tenant_id, ids=[listing_id], user_id=user.id, include_closed=include_closed)
    if not found:
        raise HTTPException(404, "매물을 찾을 수 없습니다.")
    return found[0]


def _own_listing(user: CurrentUser, listing: dict):
    if not (listing["mine"] or user.role == "admin"):
        raise HTTPException(403, "담당 중개사나 관리자만 매물을 바꿀 수 있습니다.")


_CUSTOMER_SQL = f"""
SELECT c.id, c.name, c.deal_type, c.phone_last4, c.agent_id, u.name AS agent_name, c.budget_max, c.area_min::float AS area_min,
       c.monthly_rent_max, c.privacy_consent_at, c.district, c.station_walk_max, c.preferences, c.first_home, c.created_at,
       (SELECT d.stage FROM deals d WHERE d.customer_id = c.id AND d.stage <> 'dropped'
        ORDER BY {drafting.STAGE_ORDER_SQL} DESC LIMIT 1) AS top_stage,
       (SELECT count(*) FROM deals d WHERE d.customer_id = c.id AND d.stage <> 'dropped')::int AS active_deals
FROM customers c JOIN users u ON u.id = c.agent_id
WHERE c.tenant_id = %(tenant)s {{where}}
ORDER BY c.created_at DESC, c.id DESC"""


def _office(conn, tenant_id: int) -> dict:
    row = conn.execute("SELECT contact_owner_only FROM office_settings WHERE tenant_id = %s", (tenant_id,)).fetchone()
    return {"contact_owner_only": bool(row and row["contact_owner_only"])}


def _can_see_contact(user: CurrentUser, agent_id: int, office: dict) -> bool:
    return not office["contact_owner_only"] or user.role == "admin" or user.id == agent_id


def _customers(conn, tenant_id: int, viewer: CurrentUser | None = None, **filters) -> list[dict]:
    """연락처는 끝 4자리 가림 표시(phone)만 내보낸다. 사무소 설정이 '담당자만'이면 담당·관리자가 아닐 때 가림 표시도 숨긴다"""
    where, params = [], {"tenant": tenant_id}
    for col, val in filters.items():
        if val is not None:
            where.append(f"AND c.{col} = %({col})s")
            params[col] = val
    rows = conn.execute(_CUSTOMER_SQL.format(where=" ".join(where)), params).fetchall()
    office = _office(conn, tenant_id)
    out = []
    for r in rows:
        r = dict(r)
        last = r.pop("phone_last4")
        visible = viewer is None or _can_see_contact(viewer, r["agent_id"], office)
        consent = r.pop("privacy_consent_at")
        out.append({**r, "phone": vault.masked(last) if visible else None, "has_phone": bool(last),
                    "phone_hidden": bool(last) and not visible, "privacy_consent_at": consent.isoformat() if consent else None,
                    "created_at": r["created_at"].isoformat()})
    return out


def _customer(conn, user: CurrentUser, cid: int) -> dict:
    found = _customers(conn, user.tenant_id, user, id=cid)
    if not found:
        raise HTTPException(404, "고객을 찾을 수 없습니다.")  # 다른 사무소 고객의 존재 여부도 알리지 않는다
    return found[0]


def _deal(conn, user: CurrentUser, deal_id: int) -> dict:
    d = workflow.get_deal(conn, user.tenant_id, deal_id)
    if not d:
        raise HTTPException(404, "거래를 찾을 수 없습니다.")
    return d


def _report(conn, user: CurrentUser, report_id: int, request: Request) -> dict:
    r = workflow.load_report(conn, user.tenant_id, report_id,
                             base_url=settings.public_base_url or str(request.base_url).rstrip("/"))
    if not r:
        raise HTTPException(404, "고객 자료를 찾을 수 없습니다.")
    return r


# ---------- 인증·사무소 ----------

@router.post("/auth/login")
def login(body: LoginIn):
    row = fetch_one(
        """SELECT u.id, u.tenant_id, t.name AS tenant_name, u.name, u.email, u.role, u.password_hash, u.active
           FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.email = %s""",
        (body.email.strip().lower(),),
    )
    if not row or not verify_password(body.password, row.pop("password_hash")):
        raise HTTPException(401, "이메일 또는 비밀번호가 올바르지 않습니다.")
    if not row.pop("active"):
        raise HTTPException(403, "정지된 계정입니다. 사무소 관리자에게 문의하세요.")
    user = CurrentUser(**row)
    with tx() as conn:
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="auth.login", entity="user", entity_id=user.id)
    return {"access_token": create_token(user.id), "token_type": "bearer", "user": user.public()}


@router.post("/auth/signup", status_code=201)
def signup(body: SignupIn):
    """새 사무소와 그 관리자 계정을 만들고 바로 로그인 상태로 돌려준다. 다른 사무소의 자료는 보이지 않는다"""
    if not settings.signup_enabled:
        raise HTTPException(403, "지금은 회원가입을 받지 않습니다. 관리자에게 계정을 요청하세요.")
    try:
        with tx() as conn:
            if conn.execute("SELECT 1 FROM users WHERE email = %s", (body.email,)).fetchone():
                raise HTTPException(409, "이미 가입된 이메일입니다. 로그인해 주세요.")
            tenant = conn.execute("INSERT INTO tenants (name) VALUES (%s) RETURNING id, name",
                                  (body.office_name,)).fetchone()
            row = conn.execute(
                """INSERT INTO users (tenant_id, email, name, role, password_hash)
                   VALUES (%s, %s, %s, 'admin', %s) RETURNING id, tenant_id, name, email, role""",
                (tenant["id"], body.email, body.name, hash_password(body.password)),
            ).fetchone()
            user = CurrentUser(**row, tenant_name=tenant["name"])
            record(conn, tenant_id=user.tenant_id, user_id=user.id, event="auth.signup", entity="user", entity_id=user.id)
    except psycopg.errors.UniqueViolation:  # 같은 이메일이 동시에 가입한 경우
        raise HTTPException(409, "이미 가입된 이메일입니다. 로그인해 주세요.") from None
    return {"access_token": create_token(user.id), "token_type": "bearer", "user": user.public()}


@router.get("/me")
def me(user: CurrentUser = Depends(current_user)):
    return user.public()


@router.get("/agents")
def agents(user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        return conn.execute("SELECT id, name, role FROM users WHERE tenant_id = %s AND active ORDER BY role DESC, id",
                            (user.tenant_id,)).fetchall()


# ---------- 매물 ----------

@router.get("/listings")
def list_listings(mine: bool = False, sort: Literal["price", "recent"] = "price", district: str | None = None,
                  max_price: int | None = None, min_area: float | None = None,
                  deal: Literal["sale", "jeonse", "monthly"] | None = None, user: CurrentUser = Depends(current_user)):
    """deal을 주면 그 거래 종류로 내놓은 매물만, max_price는 그 종류의 금액(매매가·보증금)에 적용한다"""
    with pool.connection() as conn:
        items = drafting.fetch_listings(conn, user.tenant_id, district=district or None, max_price=max_price,
                                        min_area=min_area, sort=sort, user_id=user.id, mine=mine, deal=deal)
    return {"items": items, "total": len(items)}


@router.get("/listings/{listing_id}")
def get_listing(listing_id: int, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        listing = _listing(conn, user, listing_id)
        return {"listing": listing, "trade_reference": drafting.trade_reference(conn, listing),
                "deals": workflow.list_deals(conn, user.tenant_id, listing_id=listing_id),
                "checks": workflow.listing_checks(conn, user, listing),
                "notes": assistant.listing_notes(conn, [listing_id]).get(listing_id, [])}


# ---------- 매물 ↔ 공공데이터 (단지·건축물대장·지하철역) ----------

@router.get("/listings/{listing_id}/public")
def listing_public(listing_id: int, user: CurrentUser = Depends(current_user)):
    """연결된 공공데이터와 근거, 아직 연결하지 않은 종류의 후보. 질문 중 외부 API는 부르지 않는다."""
    with pool.connection() as conn:
        listing = _listing(conn, user, listing_id)
        fx = structured.facts(conn, user.tenant_id, listing)
        return {"links": fx["links"], "candidates": structured.candidates(conn, listing),
                "facts": {k: ({"value": fx[k]["value"], "evidence": fx[k]["evidence"]} if fx[k] else None)
                          for k in ("rent", "complex", "building", "station")},
                "can_edit": listing["mine"] or user.role == "admin"}


@router.put("/listings/{listing_id}/links/{kind}")
def link_listing(listing_id: int, kind: Literal["complex", "building", "station"], body: LinkIn,
                 user: CurrentUser = Depends(current_user)):
    """후보 중 하나를 사람이 확정한다. 매물 담당·관리자만."""
    with tx() as conn:
        listing = _listing(conn, user, listing_id)
        _own_listing(user, listing)
        link = _guard(structured.confirm, conn, user, listing, kind, body.entity_key.strip())
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.linked", entity="listing",
               entity_id=listing_id, payload={"kind": kind, "entity_key": link["entity_key"], "method": link["match_method"]})
        return link


@router.delete("/listings/{listing_id}/links/{kind}")
def unlink_listing(listing_id: int, kind: Literal["complex", "building", "station"], user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        listing = _listing(conn, user, listing_id)
        _own_listing(user, listing)
        structured.unlink(conn, user.tenant_id, listing_id, kind)
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.unlinked", entity="listing",
               entity_id=listing_id, payload={"kind": kind})
    return {"deleted": kind}


@router.post("/listings/{listing_id}/notes", status_code=201)
def add_listing_note(listing_id: int, body: NoteIn, user: CurrentUser = Depends(current_user)):
    """현장 메모는 사무소 누구나 적을 수 있다 (질문 검색에서 매물을 찾을 때 함께 본다)."""
    with tx() as conn:
        _listing(conn, user, listing_id)
        row = conn.execute("INSERT INTO listing_notes (listing_id, user_id, text) VALUES (%s,%s,%s) RETURNING id",
                           (listing_id, user.id, body.text.strip())).fetchone()
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.note_added", entity="listing", entity_id=listing_id)
        return next(n for n in assistant.listing_notes(conn, [listing_id])[listing_id] if n["id"] == row["id"])


@router.delete("/listings/{listing_id}/notes/{note_id}")
def delete_listing_note(listing_id: int, note_id: int, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        _listing(conn, user, listing_id)
        note = conn.execute("SELECT user_id FROM listing_notes WHERE id = %s AND listing_id = %s", (note_id, listing_id)).fetchone()
        if not note:
            raise HTTPException(404, "메모를 찾을 수 없습니다.")
        if note["user_id"] != user.id and user.role != "admin":
            raise HTTPException(403, "메모를 쓴 사람이나 관리자만 지울 수 있습니다.")
        conn.execute("DELETE FROM listing_notes WHERE id = %s", (note_id,))
    return {"deleted": note_id}


@router.put("/listings/{listing_id}/checks/{key}")
def set_check(listing_id: int, key: str, body: CheckIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        return _guard(workflow.set_check, conn, user, _listing(conn, user, listing_id), key, body.checked)


@router.post("/listings", status_code=201)
def create_listing(body: ListingIn, user: CurrentUser = Depends(current_user)):
    data = body.clean()
    with tx() as conn:
        row = conn.execute(
            f"""INSERT INTO listings (tenant_id, agent_id, label, {", ".join(LISTING_FIELDS)}, source, source_date)
                VALUES (%(tenant)s, %(user)s, %(label)s, {", ".join(f"%({k})s" for k in LISTING_FIELDS)},
                        '중개사 직접 등록', current_date) RETURNING id""",
            {**data, "tenant": user.tenant_id, "user": user.id, "label": drafting.next_label(conn, user.tenant_id)},
        ).fetchone()
        conn.execute("INSERT INTO listing_price_history (listing_id, price, changed_at) VALUES (%s, %s, current_date)",
                     (row["id"], drafting.primary_amount(data)))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.created", entity="listing", entity_id=row["id"])
        return _listing(conn, user, row["id"])


@router.put("/listings/{listing_id}")
def update_listing(listing_id: int, body: ListingIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        before = _listing(conn, user, listing_id)
        _own_listing(user, before)
        data = body.clean()
        conn.execute(
            f"""UPDATE listings SET {", ".join(f"{k}=%({k})s" for k in LISTING_FIELDS)}, source_date=current_date
                WHERE id=%(id)s AND tenant_id=%(tenant)s""",
            {**data, "id": listing_id, "tenant": user.tenant_id},
        )
        changed = drafting.primary_amount(data) != drafting.primary_amount(before)
        if changed:
            conn.execute("INSERT INTO listing_price_history (listing_id, price, changed_at) VALUES (%s, %s, current_date)",
                         (listing_id, drafting.primary_amount(data)))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.updated", entity="listing", entity_id=listing_id,
               payload={"price_changed": changed})
        return _listing(conn, user, listing_id)


@router.post("/listings/{listing_id}/close")
def close_listing(listing_id: int, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        _own_listing(user, _listing(conn, user, listing_id))
        conn.execute("UPDATE listings SET status = 'closed' WHERE id = %s AND tenant_id = %s", (listing_id, user.tenant_id))
        # 거래가 끝난 매물의 출입 정보는 남겨 두지 않는다
        conn.execute("UPDATE mandates SET access_enc = NULL WHERE listing_id = %s AND tenant_id = %s", (listing_id, user.tenant_id))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.closed", entity="listing", entity_id=listing_id)
        return _listing(conn, user, listing_id, include_closed=True)


# ---------- 의뢰인(집주인)·의뢰 조건·방문 안내 ----------

def _owner_out(r: dict, prefix: str = "") -> dict:
    consent = r[f"{prefix}privacy_consent_at"]
    return {"id": r[f"{prefix}id"], "name": r[f"{prefix}name"], "relation": r[f"{prefix}relation"], "memo": r[f"{prefix}memo"],
            "phone": vault.masked(r[f"{prefix}phone_last4"]), "has_phone": bool(r[f"{prefix}phone_last4"]),
            "privacy_consent_at": consent.isoformat() if consent else None}


def _mandate(conn, tenant_id: int, listing_id: int) -> dict | None:
    r = conn.execute(
        """SELECT m.*, o.id AS o_id, o.name AS o_name, o.relation AS o_relation, o.memo AS o_memo, o.phone_last4 AS o_phone_last4,
                  o.privacy_consent_at AS o_privacy_consent_at, u.name AS updated_by_name
           FROM mandates m JOIN owners o ON o.id = m.owner_id LEFT JOIN users u ON u.id = m.updated_by
           WHERE m.listing_id = %s AND m.tenant_id = %s""", (listing_id, tenant_id)).fetchone()
    if not r:
        return None
    return {"owner": _owner_out(r, "o_"), "kind": r["kind"],
            "starts_on": str(r["starts_on"]) if r["starts_on"] else None,
            "ends_on": str(r["ends_on"]) if r["ends_on"] else None,
            "days_left": (r["ends_on"] - date.today()).days if r["ends_on"] else None,
            "price_flex": r["price_flex"], "move_out": r["move_out"], "occupancy": r["occupancy"],
            "tenant_phone": vault.masked(r["tenant_phone_last4"]), "has_tenant_phone": bool(r["tenant_phone_last4"]),
            "visit_rule": r["visit_rule"], "has_access": bool(r["access_enc"]),
            "updated_by": r["updated_by_name"], "updated_at": r["updated_at"].isoformat()}


def _new_owner(conn, user: CurrentUser, o: OwnerIn) -> int:
    d = o.clean()
    return conn.execute(
        """INSERT INTO owners (tenant_id, name, phone_enc, phone_last4, relation, memo, privacy_consent_at, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() END, %s) RETURNING id""",
        (user.tenant_id, d["name"], vault.seal(d["phone"]), vault.last4(d["phone"]), d["relation"] or "본인", d["memo"],
         d["privacy_consent"], user.id)).fetchone()["id"]


@router.get("/owners")
def list_owners(q: str | None = None, user: CurrentUser = Depends(current_user)):
    """의뢰인 고르기용 목록 (연락처는 가림 표시). q: 이름 일부"""
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT o.*, (SELECT count(*) FROM mandates m WHERE m.owner_id = o.id)::int AS listings
               FROM owners o WHERE o.tenant_id = %s AND (%s::text IS NULL OR o.name ILIKE '%%' || %s || '%%')
               ORDER BY o.created_at DESC, o.id DESC LIMIT 50""", (user.tenant_id, q or None, q or None)).fetchall()
    return [{**_owner_out(r), "listings": r["listings"]} for r in rows]


@router.put("/owners/{owner_id}")
def update_owner(owner_id: int, body: OwnerIn, user: CurrentUser = Depends(current_user)):
    """의뢰인 정보 수정: 관리자, 등록한 사람, 이 의뢰인이 맡긴 매물의 담당 중개사"""
    d = body.clean()
    with tx() as conn:
        o = conn.execute("SELECT * FROM owners WHERE id = %s AND tenant_id = %s", (owner_id, user.tenant_id)).fetchone()
        if not o:
            raise HTTPException(404, "의뢰인을 찾을 수 없습니다.")
        mine = conn.execute("""SELECT 1 FROM mandates m JOIN listings l ON l.id = m.listing_id
                               WHERE m.owner_id = %s AND l.agent_id = %s LIMIT 1""", (owner_id, user.id)).fetchone()
        if not (user.role == "admin" or o["created_by"] == user.id or mine):
            raise HTTPException(403, "관리자나 이 의뢰인 매물의 담당 중개사만 고칠 수 있습니다.")
        conn.execute(
            """UPDATE owners SET name=%s, relation=%s, memo=%s,
                      privacy_consent_at = CASE WHEN %s THEN COALESCE(privacy_consent_at, now()) END WHERE id=%s""",
            (d["name"], d["relation"] or "본인", d["memo"], d["privacy_consent"], owner_id))
        if d["phone"] or d["clear_phone"]:
            conn.execute("UPDATE owners SET phone_enc=%s, phone_last4=%s WHERE id=%s",
                         (vault.seal(d["phone"]), vault.last4(d["phone"]), owner_id))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="owner.updated", entity="owner", entity_id=owner_id)
        r = conn.execute("SELECT * FROM owners WHERE id = %s", (owner_id,)).fetchone()
        return _owner_out(r)


@router.get("/listings/{listing_id}/mandate")
def get_mandate(listing_id: int, user: CurrentUser = Depends(current_user)):
    """의뢰인·의뢰 조건·방문 안내. 사무소 누구나 볼 수 있고(방문 약속에 필요), 연락처·출입 정보는 가림 표시만"""
    with pool.connection() as conn:
        listing = _listing(conn, user, listing_id, include_closed=True)
        return {"mandate": _mandate(conn, user.tenant_id, listing_id), "can_edit": listing["mine"] or user.role == "admin"}


@router.put("/listings/{listing_id}/mandate")
def save_mandate(listing_id: int, body: MandateIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        listing = _listing(conn, user, listing_id)
        _own_listing(user, listing)
        if body.owner is not None:
            owner_id = _new_owner(conn, user, body.owner)
        else:
            if not conn.execute("SELECT 1 FROM owners WHERE id = %s AND tenant_id = %s", (body.owner_id, user.tenant_id)).fetchone():
                raise HTTPException(404, "의뢰인을 찾을 수 없습니다.")
            owner_id = body.owner_id
        d = body.clean()
        conn.execute(
            """INSERT INTO mandates (listing_id, tenant_id, owner_id, kind, starts_on, ends_on, price_flex, move_out, occupancy,
                                     visit_rule, updated_by, updated_at)
               VALUES (%(lid)s, %(tenant)s, %(owner)s, %(kind)s, %(starts_on)s, %(ends_on)s, %(price_flex)s, %(move_out)s,
                       %(occupancy)s, %(visit_rule)s, %(user)s, now())
               ON CONFLICT (listing_id) DO UPDATE SET owner_id=EXCLUDED.owner_id, kind=EXCLUDED.kind,
                   starts_on=EXCLUDED.starts_on, ends_on=EXCLUDED.ends_on, price_flex=EXCLUDED.price_flex,
                   move_out=EXCLUDED.move_out, occupancy=EXCLUDED.occupancy, visit_rule=EXCLUDED.visit_rule,
                   updated_by=EXCLUDED.updated_by, updated_at=now()""",
            {**d, "lid": listing_id, "tenant": user.tenant_id, "owner": owner_id, "user": user.id})
        if d["tenant_phone"] or d["clear_tenant_phone"] or d["occupancy"] != "tenant":
            phone = d["tenant_phone"] if d["occupancy"] == "tenant" else None
            conn.execute("UPDATE mandates SET tenant_phone_enc=%s, tenant_phone_last4=%s WHERE listing_id=%s",
                         (vault.seal(phone), vault.last4(phone), listing_id))
        if d["access"] or d["clear_access"]:
            conn.execute("UPDATE mandates SET access_enc=%s WHERE listing_id=%s", (vault.seal(d["access"]), listing_id))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.mandate_saved", entity="listing",
               entity_id=listing_id, payload={"owner_id": owner_id, "kind": d["kind"], "occupancy": d["occupancy"]})
        return {"mandate": _mandate(conn, user.tenant_id, listing_id), "can_edit": True}


@router.delete("/listings/{listing_id}/mandate")
def delete_mandate(listing_id: int, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        _own_listing(user, _listing(conn, user, listing_id, include_closed=True))
        conn.execute("DELETE FROM mandates WHERE listing_id = %s AND tenant_id = %s", (listing_id, user.tenant_id))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.mandate_deleted", entity="listing", entity_id=listing_id)
    return {"deleted": listing_id}


@router.post("/listings/{listing_id}/mandate/reveal")
def reveal_mandate(listing_id: int, body: RevealIn, user: CurrentUser = Depends(current_user)):
    """의뢰인·세입자 연락처나 출입 정보 원문을 한 번 보여 준다. 볼 때마다 감사 기록(무엇을 봤는지만, 값은 기록하지 않음)"""
    with tx() as conn:
        _listing(conn, user, listing_id, include_closed=True)
        r = conn.execute("""SELECT o.phone_enc AS owner_phone, m.tenant_phone_enc AS tenant_phone, m.access_enc AS access
                            FROM mandates m JOIN owners o ON o.id = m.owner_id
                            WHERE m.listing_id = %s AND m.tenant_id = %s""", (listing_id, user.tenant_id)).fetchone()
        value = vault.unseal(r[body.field]) if r else None
        if not value:
            raise HTTPException(404, "저장된 정보가 없습니다.")
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="listing.secret_viewed", entity="listing",
               entity_id=listing_id, payload={"field": body.field})
        return {"value": value}


# ---------- 고객 ----------

@router.get("/customers")
def list_customers(mine: bool = False, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        return _customers(conn, user.tenant_id, user, agent_id=user.id if mine else None)


@router.get("/customers/{cid}")
def get_customer(cid: int, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        customer = _customer(conn, user, cid)
        reports = conn.execute(
            "SELECT id, kind, title, state, version, created_at FROM reports WHERE customer_id = %s ORDER BY created_at DESC", (cid,)).fetchall()
        acts = conn.execute(
            """SELECT a.at, a.text, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id
               WHERE a.customer_id = %s ORDER BY a.at DESC, a.id DESC LIMIT 100""", (cid,)).fetchall()
        return {
            "customer": customer,
            "deals": workflow.list_deals(conn, user.tenant_id, customer_id=cid),
            "reports": [{**r, "version": workflow.version_label(r["state"], r["version"]), "created_at": r["created_at"].isoformat()}
                        for r in reports],
            "activities": [{**a, "at": a["at"].isoformat()} for a in acts],
        }


@router.post("/customers", status_code=201)
def create_customer(body: CustomerIn, user: CurrentUser = Depends(current_user)):
    data = body.clean()
    with tx() as conn:
        row = conn.execute(
            """INSERT INTO customers (tenant_id, agent_id, name, deal_type, phone_enc, phone_last4, budget_max, monthly_rent_max,
                                      area_min, district, station_walk_max, preferences, first_home, privacy_consent_at)
               VALUES (%(tenant)s, %(user)s, %(name)s, %(deal_type)s, %(phone_enc)s, %(phone_last4)s, %(budget_max)s,
                       %(monthly_rent_max)s, %(area_min)s, %(district)s, %(station_walk_max)s, %(preferences)s, %(first_home)s,
                       CASE WHEN %(privacy_consent)s THEN now() END) RETURNING id""",
            {**data, "phone_enc": vault.seal(data["phone"]), "phone_last4": vault.last4(data["phone"]),
             "tenant": user.tenant_id, "user": user.id}).fetchone()
        workflow.log_activity(conn, row["id"], user.id, "고객 등록")
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="customer.created", entity="customer", entity_id=row["id"])
        return _customer(conn, user, row["id"])


@router.put("/customers/{cid}")
def update_customer(cid: int, body: CustomerIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        before = _customer(conn, user, cid)
        data = body.clean()
        if (data["phone"] or data["clear_phone"]) and before["phone_hidden"]:
            raise HTTPException(403, "이 고객의 연락처는 담당 중개사나 관리자만 바꿀 수 있습니다.")
        conn.execute(
            """UPDATE customers SET name=%(name)s, deal_type=%(deal_type)s, budget_max=%(budget_max)s,
                      monthly_rent_max=%(monthly_rent_max)s, area_min=%(area_min)s, district=%(district)s,
                      station_walk_max=%(station_walk_max)s, preferences=%(preferences)s, first_home=%(first_home)s,
                      privacy_consent_at = CASE WHEN %(privacy_consent)s THEN COALESCE(privacy_consent_at, now()) END
               WHERE id=%(id)s AND tenant_id=%(tenant)s""",
            {**data, "id": cid, "tenant": user.tenant_id})
        if data["phone"] or data["clear_phone"]:
            conn.execute("UPDATE customers SET phone_enc = %s, phone_last4 = %s WHERE id = %s",
                         (vault.seal(data["phone"]), vault.last4(data["phone"]), cid))
        workflow.log_activity(conn, cid, user.id, "찾는 조건 수정")
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="customer.updated", entity="customer", entity_id=cid)
        return {"customer": _customer(conn, user, cid), "warnings": drafting.condition_warnings(conn, user.tenant_id, data)}


@router.post("/customers/{cid}/phone")
def reveal_customer_phone(cid: int, user: CurrentUser = Depends(current_user)):
    """연락처 원문을 한 번 보여 준다. 볼 때마다 감사 기록을 남긴다 (번호는 기록하지 않음)"""
    with tx() as conn:
        c = _customer(conn, user, cid)
        if c["phone_hidden"]:
            raise HTTPException(403, "이 고객의 연락처는 담당 중개사나 관리자만 볼 수 있습니다.")
        row = conn.execute("SELECT phone_enc FROM customers WHERE id = %s", (cid,)).fetchone()
        phone = vault.unseal(row["phone_enc"])
        if not phone:
            raise HTTPException(404, "저장된 연락처가 없습니다.")
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="customer.phone_viewed", entity="customer", entity_id=cid)
        return {"phone": phone}


@router.post("/customers/{cid}/activities", status_code=201)
def add_activity(cid: int, body: ActivityIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        _customer(conn, user, cid)
        row = conn.execute("INSERT INTO activities (customer_id, user_id, text) VALUES (%s, %s, %s) RETURNING at, text",
                           (cid, user.id, body.text.strip())).fetchone()
        return {"at": row["at"].isoformat(), "text": row["text"], "user_name": user.name}


@router.get("/customers/{cid}/matches")
def customer_matches(cid: int, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        c = _customer(conn, user, cid)
        return {"items": [l for l in drafting.fetch_listings(conn, user.tenant_id, user_id=user.id) if drafting.matches(l, c)]}


# ---------- 거래 ----------

@router.get("/deals")
def list_deals(mine: bool = False, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        return workflow.list_deals(conn, user.tenant_id, agent_id=user.id if mine else None)


@router.post("/deals", status_code=201)
def create_deal(body: DealIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        listing = _listing(conn, user, body.listing_id)
        customer = _customer(conn, user, body.customer_id)
        return _guard(workflow.create_deal, conn, user, listing, customer, body.next_action)


@router.post("/deals/{deal_id}/stage")
def change_stage(deal_id: int, body: StageIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        deal, warnings = _guard(workflow.change_stage, conn, user, _deal(conn, user, deal_id), body.stage, body.reason)
        return {"deal": deal, "warnings": warnings}


@router.put("/deals/{deal_id}")
def edit_deal(deal_id: int, body: DealEditIn, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        deal = _deal(conn, user, deal_id)
        if not workflow.can_change_deal(user, deal):
            raise HTTPException(403, "거래 담당·매물 담당 중개사나 관리자만 고칠 수 있습니다.")
        conn.execute("UPDATE deals SET next_action = %s WHERE id = %s", ((body.next_action or "").strip() or None, deal_id))
        return _deal(conn, user, deal_id)


# ---------- 고객 자료 ----------

@router.post("/customers/{cid}/reports", status_code=201)
def create_report(cid: int, body: ReportIn, request: Request, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        customer = _customer(conn, user, cid)
        rid = _guard(workflow.create_report, conn, user, customer, body.kind,
                     listing_ids=body.listing_ids, question=body.question, quote_id=body.quote_id, drop=body.drop)
        return _report(conn, user, rid, request)


@router.get("/reports/{rid}")
def get_report(rid: int, request: Request, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        return _report(conn, user, rid, request)


@router.put("/reports/{rid}")
def edit_report(rid: int, body: ReportEditIn, request: Request, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        _guard(workflow.edit_report, conn, user, _report(conn, user, rid, request), body.opinion, body.to_check)
        return _report(conn, user, rid, request)


@router.post("/reports/{rid}/review")
def review_report(rid: int, request: Request, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        _guard(workflow.request_review, conn, user, _report(conn, user, rid, request))
        return _report(conn, user, rid, request)


@router.post("/reports/{rid}/approve")
def approve_report(rid: int, body: ApproveIn, request: Request, user: CurrentUser = Depends(current_user)):
    if not body.confirm:
        raise HTTPException(400, "출처·기준일·확인할 사항을 확인했다는 표시가 필요합니다.")
    with tx() as conn:
        _guard(workflow.approve, conn, user, _report(conn, user, rid, request))
        return _report(conn, user, rid, request)


@router.post("/reports/{rid}/share")
def share_report(rid: int, request: Request, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        _guard(workflow.share, conn, user, _report(conn, user, rid, request))
        return _report(conn, user, rid, request)


@router.get("/reports/{rid}/export", response_class=HTMLResponse)
def export_report(rid: int, request: Request, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        r = _report(conn, user, rid, request)
        if r["state"] not in ("approved", "shared"):
            raise HTTPException(409, "승인한 자료만 인쇄할 수 있습니다.")
        workflow.log_activity(conn, r["customer_id"], user.id, f"{r['title']} 인쇄·PDF 저장")
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="report.exported", entity="report", entity_id=rid)
    return workflow.render_html(r, user.tenant_name, print_on_load=True)


@public.get("/r/{token}", response_class=HTMLResponse, include_in_schema=False)
def shared_report(token: str):
    with tx() as conn:
        found = workflow.open_shared(conn, token)
    if not found:
        raise HTTPException(404, "링크가 만료되었거나 없는 자료입니다.")
    report, office = found
    return workflow.render_html(report, office, print_on_load=False)


# ---------- 질문 검색 ----------

@router.post("/search")
def search(body: SearchIn, user: CurrentUser = Depends(current_user)):
    """질문 하나로 매물·실거래가·법령·정책·사무소 자료·기사를 함께 찾아 답변 초안과 맞는 매물을 돌려준다."""
    with tx() as conn:
        result = _guard(hood.ask, conn, user, body.q, drop=body.drop, session_id=body.session_id,
                        exclude_types=body.exclude_types)
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="search.asked", entity="ai_session",
               entity_id=result["session_id"],
               payload={"generator": result["generator"], "listings": [l["id"] for l in result["listings"]],
                        "sources": [s["id"] for s in result["sources"]], "gate": result["gate"]["status"]})
    return result


# ---------- Hood AI: 대화·설정·사용량·보고서 ----------

@router.get("/ai/sessions")
def ai_sessions(user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        return hood.list_sessions(conn, user)


@router.get("/ai/sessions/{sid}")
def ai_session(sid: int, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        return _guard(hood.get_session, conn, user, sid)


@router.delete("/ai/sessions/{sid}")
def ai_session_delete(sid: int, user: CurrentUser = Depends(current_user)):
    with tx() as conn:
        _guard(hood.delete_session, conn, user, sid)
    return {"deleted": sid}


@router.get("/ai/settings")
def ai_settings(user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        s = hood.get_settings(conn, user.tenant_id)
        used = hood.month_count(conn, user.tenant_id)
    return {**s, "month_used": used, "can_edit": user.role == "admin",
            "llm": {"enabled": llm.is_enabled(), "model": llm.settings.llm_model if llm.is_enabled() else None}}


@router.put("/ai/settings")
def ai_settings_save(body: AISettingsIn, user: CurrentUser = Depends(require_admin)):
    with tx() as conn:
        s = _guard(hood.save_settings, conn, user, body.model_dump())
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="ai.settings_saved", entity="tenant",
               entity_id=user.tenant_id, payload=body.model_dump())
    return s


@router.get("/ai/usage")
def ai_usage(days: int = 14, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        return hood.usage(conn, user, days=max(7, min(days, 31)))


@router.get("/reports")
def list_reports(state: Literal["draft", "review", "done"] | None = None, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        items = hood.list_reports(conn, user.tenant_id, state)
        counts = hood.report_counts(conn, user.tenant_id)
    return {"items": [{**r, "version": workflow.version_label(r["state"], r["version"])} for r in items], "counts": counts}


# ---------- 자료실 ----------

@router.get("/documents")
def list_documents(type: Literal["law", "policy", "office", "news"] | None = None, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT d.id, d.source_type AS type, d.title, d.publisher AS org, d.published_at AS date, d.effective_date,
                      d.region, d.created_by, u.name AS author,
                      (SELECT count(*) FROM chunks c WHERE c.document_id = d.id)::int AS chunks,
                      (SELECT min(c.id) FROM chunks c WHERE c.document_id = d.id) AS first_chunk
               FROM documents d LEFT JOIN users u ON u.id = d.created_by
               WHERE (d.tenant_id IS NULL OR d.tenant_id = %s) AND (%s::text IS NULL OR d.source_type = %s)
               ORDER BY array_position(ARRAY['law','policy','office','news'], d.source_type), d.published_at DESC""",
            (user.tenant_id, type, type)).fetchall()
    return [{**r, "type_label": rag.TYPE_LABEL[r["type"]], "date": str(r["date"]),
             "effective_date": str(r["effective_date"]) if r["effective_date"] else None,
             "first_chunk": f"c{r['first_chunk']}" if r["first_chunk"] else None,
             "mine": r["created_by"] == user.id} for r in rows]


@router.post("/documents", status_code=201)
def add_document(body: DocumentIn, user: CurrentUser = Depends(current_user)):
    """중개사가 직접 적는 사무소 자료 (단지 정보, 현장 확인 내용, 사무소 안내). 우리 사무소에서만 검색된다."""
    data = body.clean()
    data["region"] = assistant.normalize_region(data["region"])  # 문서 지역 필터('서울 마포구' 접두 일치)와 같은 형태로
    with tx() as conn:
        doc_id, created = rag.ingest_document(
            conn, tenant_id=user.tenant_id, source_type="office", title=data["title"],
            publisher=f"{user.tenant_name} · {user.name}", published_at=date.today(), text=data["text"],
            region=data["region"], license="사무소 내부 자료", created_by=user.id)
        if not created:
            raise HTTPException(409, "같은 내용의 자료가 이미 있습니다.")
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="document.added", entity="document", entity_id=doc_id)
        first = conn.execute("SELECT min(id) AS id, count(*)::int AS n FROM chunks WHERE document_id = %s", (doc_id,)).fetchone()
    return {"id": doc_id, "first_chunk": f"c{first['id']}", "chunks": first["n"]}


@router.delete("/documents/{doc_id}")
def remove_document(doc_id: int, user: CurrentUser = Depends(current_user)):
    """자기가 추가한 사무소 자료를 지운다 (관리자는 사무소 문서 전체)."""
    with tx() as conn:
        doc = conn.execute("SELECT id, created_by, raw_path FROM documents WHERE id = %s AND tenant_id = %s",
                           (doc_id, user.tenant_id)).fetchone()
        if not doc:
            raise HTTPException(404, "이 사무소 자료가 아니거나 존재하지 않습니다.")
        if doc["created_by"] != user.id and user.role != "admin":
            raise HTTPException(403, "자료를 추가한 사람이나 관리자만 지울 수 있습니다.")
        conn.execute("DELETE FROM documents WHERE id = %s", (doc_id,))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="document.deleted", entity="document", entity_id=doc_id)
    if doc["raw_path"]:
        Path(doc["raw_path"]).unlink(missing_ok=True)
    return {"deleted": doc_id}


@router.get("/evidence/search")
def evidence_search(q: str, type: Literal["law", "policy", "office", "news"] | None = None,
                    user: CurrentUser = Depends(current_user)):
    if not q.strip():
        return {"items": [], "gate": {"status": "insufficient", "messages": []}}
    with pool.connection() as conn:
        hits = rag.search(conn, user.tenant_id, q.strip(), k=12, source_types=[type] if type else None)
    gate = rag.evidence_gate(hits, as_of=date.today(), policy_question=rag.is_policy_question(q))
    return {"items": list(gate["evidence"].values()), "gate": {"status": gate["status"], "messages": gate["messages"]}}


@router.get("/evidence/{chunk_id}")
def evidence_detail(chunk_id: str, user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        row = drafting.get_chunk(conn, user.tenant_id, chunk_id)
    if not row:
        raise HTTPException(404, "자료를 찾을 수 없습니다.")
    return rag.to_evidence(row)


# ---------- 운영 ----------

@router.get("/office/settings")
def get_office_settings(user: CurrentUser = Depends(current_user)):
    with pool.connection() as conn:
        return _office(conn, user.tenant_id)


@router.put("/office/settings")
def put_office_settings(body: OfficeSettingsIn, user: CurrentUser = Depends(require_admin)):
    with tx() as conn:
        conn.execute("""INSERT INTO office_settings (tenant_id, contact_owner_only, updated_by, updated_at) VALUES (%s, %s, %s, now())
                        ON CONFLICT (tenant_id) DO UPDATE SET contact_owner_only = EXCLUDED.contact_owner_only,
                            updated_by = EXCLUDED.updated_by, updated_at = now()""",
                     (user.tenant_id, body.contact_owner_only, user.id))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="office.settings_updated", entity="tenant",
               entity_id=user.tenant_id, payload={"contact_owner_only": body.contact_owner_only})
        return _office(conn, user.tenant_id)


_USERS_SQL = """
SELECT u.id, u.name, u.email, u.role, u.active, u.disabled_at,
       (SELECT count(*) FROM customers c WHERE c.agent_id = u.id)::int AS customers,
       (SELECT count(*) FROM listings l WHERE l.agent_id = u.id AND l.status = 'active')::int AS listings,
       (SELECT count(*) FROM deals d WHERE d.agent_id = u.id AND d.stage NOT IN ('done', 'dropped'))::int AS deals
FROM users u WHERE u.tenant_id = %s {where} ORDER BY u.active DESC, u.role DESC, u.id"""


def _users(conn, tenant_id: int, uid: int | None = None) -> list[dict]:
    rows = conn.execute(_USERS_SQL.format(where="AND u.id = %s" if uid else ""),
                        (tenant_id, uid) if uid else (tenant_id,)).fetchall()
    return [{**r, "disabled_at": r["disabled_at"].isoformat() if r["disabled_at"] else None} for r in rows]


@router.get("/admin/users")
def admin_users(user: CurrentUser = Depends(require_admin)):
    with pool.connection() as conn:
        return _users(conn, user.tenant_id)


@router.post("/admin/users", status_code=201)
def admin_create_user(body: UserCreateIn, user: CurrentUser = Depends(require_admin)):
    """사무소에 중개사 계정을 만든다. 처음 비밀번호는 관리자가 정해 전달한다"""
    try:
        with tx() as conn:
            if conn.execute("SELECT 1 FROM users WHERE email = %s", (body.email,)).fetchone():
                raise HTTPException(409, "이미 쓰는 이메일입니다.")
            row = conn.execute("""INSERT INTO users (tenant_id, email, name, role, password_hash)
                                  VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                               (user.tenant_id, body.email, body.name.strip(), body.role, hash_password(body.password))).fetchone()
            record(conn, tenant_id=user.tenant_id, user_id=user.id, event="user.created", entity="user", entity_id=row["id"],
                   payload={"role": body.role})
            return _users(conn, user.tenant_id, row["id"])[0]
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "이미 쓰는 이메일입니다.") from None


@router.post("/admin/users/{uid}/disable")
def admin_disable_user(uid: int, body: DisableIn, user: CurrentUser = Depends(require_admin)):
    """계정을 정지하고(로그인·기존 토큰 즉시 차단) 고객·매물·진행 중 거래를 다른 중개사에게 넘긴다"""
    with tx() as conn:
        target = conn.execute("SELECT id, name, role, active FROM users WHERE id = %s AND tenant_id = %s",
                              (uid, user.tenant_id)).fetchone()
        if not target:
            raise HTTPException(404, "계정을 찾을 수 없습니다.")
        if uid == user.id:
            raise HTTPException(422, "자기 계정은 정지할 수 없습니다.")
        if not target["active"]:
            raise HTTPException(409, "이미 정지된 계정입니다.")
        heir = conn.execute("SELECT id, name FROM users WHERE id = %s AND tenant_id = %s AND active",
                            (body.transfer_to, user.tenant_id)).fetchone()
        if not heir or heir["id"] == uid:
            raise HTTPException(422, "넘겨받을 중개사는 같은 사무소의 다른 활성 계정이어야 합니다.")
        moved_customers = conn.execute("UPDATE customers SET agent_id = %s WHERE agent_id = %s AND tenant_id = %s RETURNING id",
                                       (heir["id"], uid, user.tenant_id)).fetchall()
        moved_listings = conn.execute("UPDATE listings SET agent_id = %s WHERE agent_id = %s AND tenant_id = %s RETURNING id",
                                      (heir["id"], uid, user.tenant_id)).fetchall()
        moved_deals = conn.execute(
            """UPDATE deals SET agent_id = %s WHERE agent_id = %s AND tenant_id = %s AND stage NOT IN ('done', 'dropped')
               RETURNING id""", (heir["id"], uid, user.tenant_id)).fetchall()
        for c in moved_customers:
            workflow.log_activity(conn, c["id"], user.id, f"담당 중개사 변경: {target['name']} → {heir['name']} (계정 정지에 따른 인계)")
        conn.execute("UPDATE users SET active = false, disabled_at = now() WHERE id = %s", (uid,))
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="user.disabled", entity="user", entity_id=uid,
               payload={"transfer_to": heir["id"], "customers": len(moved_customers), "listings": len(moved_listings),
                        "deals": len(moved_deals)})
        return {"user": _users(conn, user.tenant_id, uid)[0],
                "moved": {"customers": len(moved_customers), "listings": len(moved_listings), "deals": len(moved_deals)}}


@router.post("/admin/users/{uid}/enable")
def admin_enable_user(uid: int, user: CurrentUser = Depends(require_admin)):
    with tx() as conn:
        if not conn.execute("UPDATE users SET active = true, disabled_at = NULL WHERE id = %s AND tenant_id = %s RETURNING id",
                            (uid, user.tenant_id)).fetchone():
            raise HTTPException(404, "계정을 찾을 수 없습니다.")
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="user.enabled", entity="user", entity_id=uid)
        return _users(conn, user.tenant_id, uid)[0]


@router.get("/public-config")
def public_config():
    """화면이 지도를 그리기 전에 읽는 공개 설정. 화면을 Cloudflare에서 내려줄 때 서버 .env의 값을 화면에 알려 준다.
    네이버 지도 Client ID는 브라우저의 지도 스크립트 주소에 실리는 공개 값이다. Client Secret은 절대 넣지 않는다"""
    return JSONResponse({"naverMapClientId": settings.naver_client_id}, headers={"Cache-Control": "no-store"})


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


@router.delete("/admin/documents/{doc_id}")
def delete_document(doc_id: int, user: CurrentUser = Depends(require_admin)):
    with tx() as conn:
        doc = conn.execute("SELECT id, raw_path FROM documents WHERE id = %s AND tenant_id = %s", (doc_id, user.tenant_id)).fetchone()
        if not doc:
            raise HTTPException(404, "이 사무소 문서가 아니거나 존재하지 않습니다. (공용 문서는 운영자가 관리)")
        conn.execute("DELETE FROM documents WHERE id = %s", (doc_id,))  # chunks는 ON DELETE CASCADE로 함께 지워진다
        record(conn, tenant_id=user.tenant_id, user_id=user.id, event="document.deleted", entity="document", entity_id=doc_id)
    if doc["raw_path"]:
        Path(doc["raw_path"]).unlink(missing_ok=True)
    return {"deleted": doc_id}


@router.post("/admin/collect/trades")
def collect_trades(body: TradeCollectIn, user: CurrentUser = Depends(require_admin)):
    with tx() as conn:
        job = conn.execute("INSERT INTO ingest_jobs (tenant_id, kind, status, detail) VALUES (%s,'trades','running',%s) RETURNING id",
                           (user.tenant_id, f"{body.lawd_cd}/{body.deal_ymd}")).fetchone()
    try:
        rows = public_data.fetch_trades(body.lawd_cd, body.deal_ymd)
    except public_data.ExternalUnavailable:
        message = public_data.TRADE_UNAVAILABLE_MESSAGE
        with tx() as conn:
            conn.execute("UPDATE ingest_jobs SET status='failed', detail=%s, finished_at=now() WHERE id=%s", (message, job["id"]))
        raise HTTPException(503, message)
    with tx() as conn:
        n = public_data.store_trades(conn, rows)
        conn.execute("UPDATE ingest_jobs SET status='done', detail=%s, finished_at=now() WHERE id=%s",
                     (f"{len(rows)}건 수신, {n}건 신규 저장", job["id"]))
    return {"received": len(rows), "inserted": n}


def _safe_public_rows(rows):
    """원천 응답과 내부 키가 캐시 조회 API로 새지 않게 한다."""
    if rows is None:
        return None
    if isinstance(rows, dict):
        return {key: value for key, value in rows.items() if key not in {"raw_payload", "source_key"}}
    return [_safe_public_rows(row) for row in rows]


def _collect_public_dataset(dataset_id: str, params: dict[str, str], label: str, user: CurrentUser):
    with tx() as conn:
        job = conn.execute(
            """INSERT INTO ingest_jobs (tenant_id, kind, status, detail)
               VALUES (%s,%s,'running',%s) RETURNING id""",
            (user.tenant_id, f"public_data:{dataset_id}", f"{dataset_id} {label}"),
        ).fetchone()
    try:
        raw_rows = public_catalog.fetch_dataset(dataset_id, params)
        with tx() as conn:
            result = public_sources.collect_and_store(
                conn, dataset_id, params, fetcher=lambda _dataset_id, _params: raw_rows
            )
    except (public_sources.PublicSourceError, public_catalog.PublicDataError):
        message = "공공데이터 수집에 실패했습니다. 승인 상태와 요청 조건을 확인해 주세요."
        with tx() as conn:
            conn.execute(
                "UPDATE ingest_jobs SET status='failed', detail=%s, finished_at=now() WHERE id=%s",
                (message, job["id"]),
            )
        raise HTTPException(503, message)
    except Exception:
        with tx() as conn:
            conn.execute(
                "UPDATE ingest_jobs SET status='failed', detail=%s, finished_at=now() WHERE id=%s",
                ("공공데이터 저장 중 오류가 발생했습니다.", job["id"]),
            )
        raise

    summary = (
        f"{result['received']}건 수신, {result['inserted']}건 신규, "
        f"{result['updated']}건 갱신, {result['invalid']}건 제외"
    )
    with tx() as conn:
        conn.execute(
            "UPDATE ingest_jobs SET status='done', detail=%s, finished_at=now() WHERE id=%s",
            (summary, job["id"]),
        )
        record(
            conn,
            tenant_id=user.tenant_id,
            user_id=user.id,
            event="public_data.collected",
            entity="ingest_job",
            entity_id=job["id"],
            payload={**result},
        )
    return {**result, "job": fetch_one("SELECT * FROM ingest_jobs WHERE id = %s", (job["id"],))}


@router.post("/admin/collect/rents")
def collect_rents(body: TradeCollectIn, user: CurrentUser = Depends(require_admin)):
    return _collect_public_dataset(
        public_sources.RENT_DATASET,
        {"LAWD_CD": body.lawd_cd, "DEAL_YMD": body.deal_ymd},
        f"{body.lawd_cd}/{body.deal_ymd}",
        user,
    )


@router.post("/admin/collect/complexes")
def collect_complexes(body: KaptCollectIn, user: CurrentUser = Depends(require_admin)):
    return _collect_public_dataset(
        public_sources.KAPT_DATASET, {"kaptCode": body.kapt_code}, body.kapt_code, user
    )


@router.post("/admin/collect/buildings")
def collect_buildings(body: BuildingCollectIn, user: CurrentUser = Depends(require_admin)):
    params = {"sigunguCd": body.sigungu_cd, "bjdongCd": body.bjdong_cd}
    if body.plat_gb_cd is not None:
        params["platGbCd"] = body.plat_gb_cd
    if body.bun is not None:
        params["bun"] = body.bun.zfill(4)
    if body.ji is not None:
        params["ji"] = body.ji.zfill(4)
    return _collect_public_dataset(
        public_sources.BUILDING_DATASET,
        params,
        f"{body.sigungu_cd}/{body.bjdong_cd}",
        user,
    )


@router.post("/admin/collect/subway-stations")
def collect_subway_stations(body: SubwayCollectIn, user: CurrentUser = Depends(require_admin)):
    return _collect_public_dataset(
        public_sources.SUBWAY_DATASET,
        {"subwayStationName": body.station_name},
        body.station_name,
        user,
    )


@router.get("/public-data/rents")
def public_rents(
    lawd_cd: str = Query(..., pattern=r"^\d{5}$"),
    complex_name: str = Query(..., min_length=1, max_length=100),
    area_m2: float = Query(..., gt=0, lt=1000),
    months: int = Query(12, ge=1, le=60),
    limit: int = Query(30, ge=1, le=200),
    user: CurrentUser = Depends(current_user),
):
    with pool.connection() as conn:
        rows = public_sources.rent_references(
            conn, lawd_cd=lawd_cd, complex_name=complex_name, area_m2=area_m2, months=months, limit=limit
        )
    return {"items": _safe_public_rows(rows), "total": len(rows)}


@router.get("/public-data/complexes/{kapt_code}")
def public_complex(kapt_code: str, user: CurrentUser = Depends(current_user)):
    if not kapt_code.isascii() or not kapt_code.isalnum() or not 1 <= len(kapt_code) <= 30:
        raise HTTPException(422, "유효한 K-apt 단지코드가 아닙니다.")
    with pool.connection() as conn:
        row = public_sources.get_complex(conn, kapt_code)
    if not row:
        raise HTTPException(404, "공동주택 정보를 찾을 수 없습니다.")
    return _safe_public_rows(row)


@router.get("/public-data/buildings")
def public_buildings(
    sigungu_cd: str = Query(..., pattern=r"^\d{5}$"),
    bjdong_cd: str = Query(..., pattern=r"^\d{5}$"),
    bun: str | None = Query(None, pattern=r"^\d{1,4}$"),
    ji: str | None = Query(None, pattern=r"^\d{1,4}$"),
    limit: int = Query(50, ge=1, le=200),
    user: CurrentUser = Depends(current_user),
):
    with pool.connection() as conn:
        rows = public_sources.find_buildings(
            conn,
            sigungu_cd=sigungu_cd,
            bjdong_cd=bjdong_cd,
            bun=bun.zfill(4) if bun else None,
            ji=ji.zfill(4) if ji else None,
            limit=limit,
        )
    return {"items": _safe_public_rows(rows), "total": len(rows)}


@router.get("/public-data/subway-stations")
def public_subway_stations(
    q: str = Query(..., min_length=1, max_length=50),
    limit: int = Query(20, ge=1, le=200),
    user: CurrentUser = Depends(current_user),
):
    name = q.strip()
    if not name:
        raise HTTPException(422, "역명을 입력해 주세요.")
    with pool.connection() as conn:
        rows = public_sources.find_subway_stations(conn, name, limit=limit)
    return {"items": _safe_public_rows(rows), "total": len(rows)}


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
