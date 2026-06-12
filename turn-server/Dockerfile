FROM coturn/coturn:latest

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["turnserver \
  --listening-port=3478 \
  --fingerprint \
  --lt-cred-mech \
  --user=${TURN_USER}:${TURN_PASSWORD} \
  --realm=${TURN_REALM:-chunsik-dodge} \
  --external-ip=${FLY_PUBLIC_IP:-0.0.0.0} \
  --no-tls \
  --no-dtls \
  --no-cli \
  --log-file=stdout \
  --verbose"]
