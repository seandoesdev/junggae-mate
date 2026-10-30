import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response

from . import db
from .api import public, router
from .audit import request_id_var
from .config import settings
from .seed import seed

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s")
log = logging.getLogger("mate")


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


for handler in logging.getLogger().handlers:
    handler.addFilter(_RequestIdFilter())


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.open_pool()
    db.init_schema()
    if settings.seed_on_start:
        seed()
    log.info("중개메이트 API 준비 완료 (llm=%s)", settings.llm_provider)
    yield
    db.pool.close()


app = FastAPI(title="중개메이트 API", version="0.1.0", lifespan=lifespan)
if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def request_id(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    token = request_id_var.set(rid)
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("처리되지 않은 오류 %s %s", request.method, request.url.path)
        response = JSONResponse({"detail": "서버 오류가 발생했습니다.", "code": "internal_error", "request_id": rid}, 500)
    finally:
        request_id_var.reset(token)
    response.headers["X-Request-ID"] = rid
    if request.url.path.startswith("/api") and response.status_code >= 400:
        log.warning("%s %s -> %s (%.0fms) rid=%s", request.method, request.url.path, response.status_code,
                    (time.perf_counter() - start) * 1000, rid)
    return response


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    code = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict",
            422: "unprocessable", 503: "unavailable"}.get(exc.status_code, "error")
    return JSONResponse({"detail": exc.detail, "code": code}, exc.status_code, headers=exc.headers)


app.include_router(router)
app.include_router(public)  # 고객용 공개 링크 /r/{token}

# 정적 화면: 허용된 파일만 제공 (저장소의 다른 파일 노출 방지)
_STATIC_SUFFIXES = {".html", ".css", ".js", ".png", ".svg", ".ico"}


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/app.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


@app.get("/{name}", include_in_schema=False)
def static_file(name: str):
    path = (settings.static_dir / name).resolve()
    if ("/" in name or "\\" in name or path.suffix not in _STATIC_SUFFIXES or not path.is_file()
            or path.parent != settings.static_dir.resolve()):
        raise HTTPException(404, "Not Found")
    return FileResponse(path)
