#!/bin/sh
# Let's Encrypt 인증서 발급·자동 갱신 (acme.sh, TLS-ALPN-01 — 443만 사용)
# nginx가 443에서 ALPN acme-tls/1 연결을 이 컨테이너의 10443으로 넘겨 준다 (deploy/nginx/nginx.conf).
# 결과: /certs/fullchain.pem, /certs/privkey.pem (nginx와 공유하는 certs 볼륨)
set -eu

: "${API_DOMAIN:?API_DOMAIN이 필요합니다 (.env)}"
CERT=/certs/fullchain.pem
KEY=/certs/privkey.pem
mkdir -p /certs

# 1) 처음에는 임시 자체 서명 인증서를 둔다 — nginx가 먼저 떠야 Let's Encrypt 확인 요청이 이 컨테이너까지 온다
if [ ! -s "$CERT" ] || [ ! -s "$KEY" ]; then
  echo "임시 인증서를 만듭니다 ($API_DOMAIN)"
  openssl req -x509 -nodes -newkey rsa:2048 -days 7 -subj "/CN=$API_DOMAIN" \
    -keyout "$KEY" -out "$CERT" >/dev/null 2>&1
fi

# 2) 아직 발급받지 않았으면 발급 (nginx가 뜰 때까지 잠시 기다린 뒤). 발급되면 /certs로 복사하고,
#    이후 갱신 때도 같은 위치로 복사되도록 acme.sh가 설정을 기억한다
if ! acme.sh --list 2>/dev/null | grep -q "^$API_DOMAIN "; then
  (
    sleep 15
    acme.sh --set-default-ca --server letsencrypt
    acme.sh --issue --alpn --tlsport 10443 -d "$API_DOMAIN" \
      ${ACME_EMAIL:+--accountemail "$ACME_EMAIL"} \
      && acme.sh --install-cert -d "$API_DOMAIN" --key-file "$KEY" --fullchain-file "$CERT" \
      && echo "Let's Encrypt 인증서를 받았습니다 ($API_DOMAIN)" \
      || echo "발급 실패: $API_DOMAIN 의 A 레코드가 이 서버를 가리키는지, 443이 밖에서 열려 있는지 확인하세요"
  ) &
fi

# 3) 하루 네 번 갱신 확인 (만료 30일 전에 갱신, 이미지 기본 크론)
exec /entry.sh daemon
