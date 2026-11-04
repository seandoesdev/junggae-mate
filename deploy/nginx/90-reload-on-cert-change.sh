#!/bin/sh
# nginx 공식 이미지가 시작할 때 실행하는 스크립트(/docker-entrypoint.d/).
# 인증서 파일이 바뀌면(처음 발급·갱신) nginx가 다시 읽도록, 1분마다 바뀐 시각을 보고 reload 한다.
CERT=/certs/fullchain.pem
(
  last=$(stat -c %Y "$CERT" 2>/dev/null || echo 0)
  while sleep 60; do
    cur=$(stat -c %Y "$CERT" 2>/dev/null || echo 0)
    if [ "$cur" != "$last" ]; then
      last=$cur
      echo "인증서가 바뀌어 nginx를 다시 읽습니다"
      nginx -s reload || true
    fi
  done
) &
