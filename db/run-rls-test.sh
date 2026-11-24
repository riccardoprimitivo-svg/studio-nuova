#!/usr/bin/env bash
# Avvia un Postgres temporaneo, simula la parte minima di Supabase (schema auth, ruoli) e lancia il test RLS.
# Postgres non parte come root: in quel caso il test viene rilanciato come utente "postgres".
set -euo pipefail
if [ "$(id -u)" = "0" ]; then
  SRC=$(mktemp -d); cp "$(dirname "$0")"/schema.sql "$(dirname "$0")"/rls-test.sql "$SRC"/
  cp "$0" "$SRC"/run.sh; chmod -R a+rX "$SRC"
  trap 'rm -rf "$SRC"' EXIT
  runuser -u postgres -- bash "$SRC/run.sh"
  exit $?
fi
cd "$(dirname "$0")"
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
DIR=$(mktemp -d)
PORT=54999
trap '"$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT

"$PGBIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
"$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
PSQL=(psql -h "$DIR" -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" <<'SQL'
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
SQL
"${PSQL[@]}" -f schema.sql
"${PSQL[@]}" -f rls-test.sql 2>&1 | grep -E "NOTICE|ERROR|NON SUPERATO" | sed 's/^psql:[^ ]* //'
echo "TEST RLS: SUPERATO"
