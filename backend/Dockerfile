# 1) 화면(React) 빌드
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2) API 서버
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STATIC_DIR=/app/static \
    RAW_DOCS_DIR=/data/raw

WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/ ./
# 웹 화면은 허용된 정적 파일만 이미지에 포함: 소개 페이지(index.html 등) + React 빌드(app.html, assets/)
COPY *.html *.css *.js ./static/
COPY --from=web /web/dist/ ./static/

RUN useradd --create-home --uid 10001 mate && mkdir -p /data/raw && chown -R mate /data /app
USER mate

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
