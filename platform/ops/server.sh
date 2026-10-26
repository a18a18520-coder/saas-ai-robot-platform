#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${SERVER_ENV_FILE:-$ROOT/deploy/server/.env}"
export SERVER_ENV_FILE="$ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then echo '请先复制 deploy/server/.env.example 为 .env 并完成配置。' >&2; exit 1; fi
# A fixed project name isolates the server deployment from local development containers.
compose() { docker compose --project-name robot-platform-server --env-file "$ENV_FILE" -f "$ROOT/deploy/server/compose.yml" "$@"; }
case "${1:-status}" in
  validate) compose config --quiet ;;
  backup)
    command -v flock >/dev/null || { echo "需要 Linux util-linux/flock" >&2; exit 1; }
    exec 9>"$ROOT/deploy/server/.operation.lock"
    flock -n 9 || { echo "另一部署/备份操作正在进行" >&2; exit 1; }
    destination="$ROOT/deploy/server/backups/$(date -u +%Y%m%dT%H%M%SZ)"
    umask 077
    mkdir -p "$destination"
    touch "$destination/INCOMPLETE"
    running="$(compose ps --status running -q backend)"
    resume() { if [ -n "$running" ]; then compose start backend; fi; }
    trap resume EXIT
    compose stop backend
    compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$destination/database.dump"
    compose run --rm --no-deps -T --user root --entrypoint tar backend -C /app/uploads -czf - . > "$destination/uploads.tar.gz"
    compose exec -T postgres pg_restore --list < "$destination/database.dump" > "$destination/database.contents"
    tar -tzf "$destination/uploads.tar.gz" > "$destination/uploads.contents"
    (cd "$destination" && sha256sum database.dump uploads.tar.gz > SHA256SUMS)
    rm "$destination/INCOMPLETE"
    echo "备份完成：$destination；请另行安全保管 .env 和 Dify 备份。"
    ;;
  build) compose build --pull backend web ;;
  deploy)
    command -v flock >/dev/null || { echo "需要 Linux util-linux/flock" >&2; exit 1; }
    exec 9>"$ROOT/deploy/server/.operation.lock"
    flock -n 9 || { echo "另一部署/备份操作正在进行" >&2; exit 1; }
    compose config --quiet
    compose run --rm --no-deps --entrypoint node preflight -e 'require("./dist/config/environment").validateEnvironment(process.env)'
    compose up -d --wait postgres redis
    compose stop backend
    compose run --rm migrate
    compose run --rm --no-deps preflight
    compose up -d --wait --wait-timeout 180 backend web gateway
    ;;
  status) compose ps ;;
  logs) compose logs --tail=150 "${2:-backend}" ;;
  preflight) compose run --rm --no-deps preflight ;;
  *) echo '用法：bash ops/server.sh validate|build|deploy|status|logs [服务]|preflight|backup' >&2; exit 1 ;;
esac
