#!/bin/sh
# Let's Encrypt 인증서 발급·자동 갱신 (acme.sh, TLS-ALPN-01 — 443만 사용)
# nginx가 443에서 ALPN acme-tls/1 연결을 이 컨테이너의 10443으로 넘겨 준다 (deploy/nginx/nginx.conf).
# 결과: /certs/fullchain.pem, /certs/privkey.pem (nginx와 공유하는 certs 볼륨)
#
# 환경 변수
#   API_DOMAIN   (필수) 인증서를 받을 도메인. A 레코드가 이 서버의 공인 IP를 가리켜야 한다
#   ACME_EMAIL   (선택) 만료 안내 메일
#   ACME_SERVER  (선택) 발급 서버. 기본 letsencrypt. 시험할 때는 letsencrypt_test(스테이징)
#   ACME_ARGS    (선택) acme.sh --issue에 더할 인자 (예: --insecure, --debug 2)
set -eu

: "${API_DOMAIN:?API_DOMAIN이 필요합니다 (.env)}"
SERVER="${ACME_SERVER:-letsencrypt}"
CERT=/certs/fullchain.pem
KEY=/certs/privkey.pem
HOME_DIR="${LE_CONFIG_HOME:-/acme.sh}"
ISSUED="$HOME_DIR/${API_DOMAIN}_ecc/fullchain.cer"
mkdir -p /certs

# 1) 임시 자체 서명 인증서 — nginx가 먼저 떠야 Let's Encrypt 확인 요청이 이 컨테이너까지 온다.
#    도메인이 바뀌었으면(.env 수정) 임시 인증서도 새로 만든다
current_cn=$(openssl x509 -noout -subject -in "$CERT" 2>/dev/null | sed -n 's/.*CN *= *//p' || true)
if [ ! -s "$CERT" ] || [ ! -s "$KEY" ] || { [ ! -s "$ISSUED" ] && [ "$current_cn" != "$API_DOMAIN" ]; }; then
  echo "임시 인증서를 만듭니다 ($API_DOMAIN)"
  openssl req -x509 -nodes -newkey rsa:2048 -days 7 -subj "/CN=$API_DOMAIN" \
    -keyout "$KEY" -out "$CERT" >/dev/null 2>&1
fi

issue_once() {
  acme.sh --set-default-ca --server "$SERVER" >/dev/null
  # shellcheck disable=SC2086
  acme.sh --issue --alpn --tlsport 10443 -d "$API_DOMAIN" --server "$SERVER" --force \
    ${ACME_EMAIL:+--accountemail "$ACME_EMAIL"} ${ACME_ARGS:-} \
    && acme.sh --install-cert -d "$API_DOMAIN" --key-file "$KEY" --fullchain-file "$CERT"
}

# 2) 아직 발급받은 인증서가 없으면 발급. 실패하면 15분 간격으로 최대 4번 다시 시도한다
#    (Let's Encrypt는 같은 이름의 확인 실패를 1시간에 5번까지 허용한다)
if [ ! -s "$ISSUED" ]; then
  (
    sleep 15   # nginx가 뜰 때까지
    n=1
    while :; do
      echo "Let's Encrypt 인증서 발급 시도 $n/4 ($API_DOMAIN, 서버 $SERVER)"
      if issue_once; then
        echo "Let's Encrypt 인증서를 받았습니다 ($API_DOMAIN)"
        break
      fi
      echo "발급 실패 $n/4: 바로 위 acme.sh 로그의 오류(Verify error, Invalid status 등)를 확인하세요."
      echo "  점검: $API_DOMAIN A 레코드 → 이 서버 공인 IP, 밖에서 TCP 443 접속, nginx 컨테이너 실행 중"
      [ "$n" -ge 4 ] && { echo "자동 재시도를 멈춥니다. 원인을 고친 뒤 acme 컨테이너를 다시 시작하세요."; break; }
      n=$((n + 1))
      sleep 900
    done
  ) &
else
  echo "발급받은 인증서가 있습니다 ($API_DOMAIN). 갱신은 하루 네 번 자동 확인합니다"
fi

# 3) 하루 네 번 갱신 확인 (만료 30일 전에 갱신, 이미지 기본 크론)
exec /entry.sh daemon
