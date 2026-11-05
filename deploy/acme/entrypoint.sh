#!/bin/sh
# 인증서 발급·자동 갱신 (acme.sh). 기본 발급처는 ZeroSSL, 확인은 HTTP-01(80 포트).
# 결과: /certs/fullchain.pem, /certs/privkey.pem (nginx와 공유하는 certs 볼륨)
#
# 확인 방식 (ACME_CHALLENGE)
#   http (기본) — 발급처가 http://도메인/.well-known/acme-challenge/… 를 확인한다.
#                 nginx(80)가 그 경로를 acme_webroot 볼륨에서 내려주고, 나머지는 https로 돌린다.
#   alpn        — 443만으로 확인(TLS-ALPN-01). nginx(443)가 ALPN acme-tls/1 연결을 이 컨테이너 10443으로 넘긴다.
#                 Let's Encrypt는 지원, ZeroSSL은 지원하지 않는다.
#
# 환경 변수
#   API_DOMAIN       (필수) 인증서를 받을 도메인. A 레코드가 이 서버의 공인 IP를 가리켜야 한다
#   ACME_EMAIL       ZeroSSL은 필수(계정 등록). 만료 안내도 이 주소로 온다
#   ACME_SERVER      발급처. 기본 zerossl. 그 밖에 letsencrypt, letsencrypt_test, 또는 ACME 디렉터리 URL
#   ACME_CHALLENGE   http(기본) | alpn
#   ZEROSSL_EAB_KID, ZEROSSL_EAB_HMAC_KEY  (선택) ZeroSSL 대시보드에서 만든 EAB. 없으면 이메일로 자동 등록
#   ACME_ARGS        (선택) acme.sh --issue에 더할 인자 (예: --debug 2, --insecure)
set -eu

: "${API_DOMAIN:?API_DOMAIN이 필요합니다 (.env)}"
SERVER="${ACME_SERVER:-zerossl}"
CHALLENGE="${ACME_CHALLENGE:-http}"
WEBROOT=/acme-webroot
CERT=/certs/fullchain.pem
KEY=/certs/privkey.pem
HOME_DIR="${LE_CONFIG_HOME:-/acme.sh}"
ISSUED="$HOME_DIR/${API_DOMAIN}_ecc/fullchain.cer"
mkdir -p /certs "$WEBROOT/.well-known/acme-challenge"

if [ "$SERVER" = "zerossl" ] && [ -z "${ACME_EMAIL:-}" ] && [ -z "${ZEROSSL_EAB_KID:-}" ]; then
  echo "ZeroSSL은 계정 등록에 ACME_EMAIL(또는 ZEROSSL_EAB_KID·ZEROSSL_EAB_HMAC_KEY)이 필요합니다 (.env)"
  exit 1
fi
case "$CHALLENGE" in
  http) MODE="--webroot $WEBROOT" ;;
  alpn) MODE="--alpn --tlsport 10443" ;;
  *) echo "ACME_CHALLENGE는 http 또는 alpn 이어야 합니다: $CHALLENGE"; exit 1 ;;
esac

# 1) 임시 자체 서명 인증서 — nginx가 먼저 떠야 발급처의 확인 요청이 들어온다.
#    도메인이 바뀌었으면(.env 수정) 임시 인증서도 새로 만든다
current_cn=$(openssl x509 -noout -subject -in "$CERT" 2>/dev/null | sed -n 's/.*CN *= *//p' || true)
if [ ! -s "$CERT" ] || [ ! -s "$KEY" ] || { [ ! -s "$ISSUED" ] && [ "$current_cn" != "$API_DOMAIN" ]; }; then
  echo "임시 인증서를 만듭니다 ($API_DOMAIN)"
  openssl req -x509 -nodes -newkey rsa:2048 -days 7 -subj "/CN=$API_DOMAIN" \
    -keyout "$KEY" -out "$CERT" >/dev/null 2>&1
fi

register_account() {
  acme.sh --set-default-ca --server "$SERVER" >/dev/null
  if [ "$SERVER" = "zerossl" ]; then
    if [ -n "${ZEROSSL_EAB_KID:-}" ] && [ -n "${ZEROSSL_EAB_HMAC_KEY:-}" ]; then
      acme.sh --register-account --server zerossl --eab-kid "$ZEROSSL_EAB_KID" --eab-hmac-key "$ZEROSSL_EAB_HMAC_KEY" \
        ${ACME_EMAIL:+-m "$ACME_EMAIL"}
    else
      acme.sh --register-account --server zerossl -m "$ACME_EMAIL"
    fi
  fi
}

issue_once() {
  register_account
  # shellcheck disable=SC2086
  acme.sh --issue $MODE -d "$API_DOMAIN" --server "$SERVER" --force \
    ${ACME_EMAIL:+--accountemail "$ACME_EMAIL"} ${ACME_ARGS:-} \
    && acme.sh --install-cert -d "$API_DOMAIN" --key-file "$KEY" --fullchain-file "$CERT"
}

# 2) 아직 발급받은 인증서가 없으면 발급. 실패하면 15분 간격으로 최대 4번 다시 시도한다
if [ ! -s "$ISSUED" ]; then
  (
    sleep 15   # nginx가 뜰 때까지
    n=1
    while :; do
      echo "인증서 발급 시도 $n/4 ($API_DOMAIN, 발급처 $SERVER, 확인 $CHALLENGE)"
      if issue_once; then
        echo "인증서를 받았습니다 ($API_DOMAIN, 발급처 $SERVER)"
        break
      fi
      echo "발급 실패 $n/4: 바로 위 acme.sh 로그의 오류(Verify error, Invalid status, rateLimited 등)를 확인하세요."
      if [ "$CHALLENGE" = "http" ]; then
        echo "  점검: $API_DOMAIN A 레코드 → 이 서버 공인 IP, 밖에서 TCP 80·443 접속, nginx 컨테이너 실행 중"
      else
        echo "  점검: $API_DOMAIN A 레코드 → 이 서버 공인 IP, 밖에서 TCP 443 접속, nginx 컨테이너 실행 중"
      fi
      [ "$n" -ge 4 ] && { echo "자동 재시도를 멈춥니다. 원인을 고친 뒤 acme 컨테이너를 다시 시작하세요."; break; }
      n=$((n + 1))
      sleep 900
    done
  ) &
else
  echo "발급받은 인증서가 있습니다 ($API_DOMAIN). 갱신은 하루 네 번 자동 확인합니다"
fi

# 3) 하루 네 번 갱신 확인 (만료 전에 자동 갱신, 이미지 기본 크론). 발급 때 쓴 방식·위치를 acme.sh가 기억한다
exec /entry.sh daemon
