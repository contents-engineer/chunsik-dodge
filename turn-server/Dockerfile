FROM coturn/coturn:latest

# 보안 노트
# - TURN_USER/TURN_PASSWORD 미설정 시 기동 실패(fail-closed). 빈 계정으로 뜨는 것 방지.
#   비밀번호는 고엔트로피 값 사용: fly secrets set TURN_USER=... TURN_PASSWORD="$(openssl rand -hex 24)"
# - denied-peer-ip: 릴레이가 내부망(루프백·사설대역·링크로컬·Fly 내부 6PN)으로
#   패킷을 중계하지 못하게 차단 — 개방 릴레이를 통한 SSRF 방지.
# - TLS 미사용은 의도된 선택: WebRTC 페이로드 자체가 DTLS로 종단간 암호화되어 있어
#   TURN TLS는 할당 요청 envelope만 보호한다. 대신 비밀번호를 고엔트로피로 강제.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["turnserver \
  --listening-port=3478 \
  --fingerprint \
  --lt-cred-mech \
  --user=${TURN_USER:?TURN_USER not set}:${TURN_PASSWORD:?TURN_PASSWORD not set} \
  --realm=${TURN_REALM:-chunsik-dodge} \
  --external-ip=${FLY_PUBLIC_IP:-0.0.0.0} \
  --no-loopback-peers \
  --no-multicast-peers \
  --denied-peer-ip=0.0.0.0-0.255.255.255 \
  --denied-peer-ip=10.0.0.0-10.255.255.255 \
  --denied-peer-ip=100.64.0.0-100.127.255.255 \
  --denied-peer-ip=127.0.0.0-127.255.255.255 \
  --denied-peer-ip=169.254.0.0-169.254.255.255 \
  --denied-peer-ip=172.16.0.0-172.31.255.255 \
  --denied-peer-ip=192.0.0.0-192.0.0.255 \
  --denied-peer-ip=192.168.0.0-192.168.255.255 \
  --denied-peer-ip=198.18.0.0-198.19.255.255 \
  --denied-peer-ip=::1-::1 \
  --denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff \
  --denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff \
  --no-tls \
  --no-dtls \
  --no-cli \
  --log-file=stdout"]
