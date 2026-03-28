docker compose \
  -f docker-compose.yml \
  -f docker-compose.override.yml \
  -f docker-compose.hardened.yml \
  up -d --build