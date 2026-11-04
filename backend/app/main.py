import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

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


# CORS: 화면(Cloudflare 등)과 API 서버의 주소가 다를 때. 로그인은 Authorization 헤더(Bearer)라 쿠키를 보내지 않는다.
# 맨 바깥 미들웨어로 둔다(나중에 더한 것이 바깥): 500 오류 응답에도 CORS 헤더가 붙어 브라우저가 실제 오류를 볼 수 있다.
if settings.cors_origins or settings.cors_origin_regex:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    code = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict",
            422: "unprocessable", 503: "unavailable"}.get(exc.status_code, "error")
    return JSONResponse({"detail": exc.detail, "code": code}, exc.status_code, headers=exc.headers)


app.include_router(router)
app.include_router(public)  # 고객용 공개 링크 /r/{token}

# React 화면(frontend/)의 빌드 결과: app.html은 아래 static_file이, 묶음 파일은 /assets/* 가 내려준다.
# 이미지 안의 static/assets 폴더만 열어 두므로 저장소의 다른 파일은 보이지 않는다.
app.mount("/assets", StaticFiles(directory=settings.static_dir / "assets", check_dir=False), name="assets")

# 정적 화면: 허용된 파일만 제공 (저장소의 다른 파일 노출 방지)
_STATIC_SUFFIXES = {".html", ".css", ".js", ".png", ".svg", ".ico"}


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/app.html")


@app.get("/config.json", include_in_schema=False)
def frontend_config():
    """화면이 시작할 때 읽는 API 주소. 여기서 화면을 내려주면 같은 주소(/api)를 쓴다 (Cloudflare에서는 Pages Function이 답한다)"""
    return JSONResponse({"apiUrl": ""}, headers={"Cache-Control": "no-store"})


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
