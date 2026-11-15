#!/usr/bin/env bash
# Runs the real migrations on plain Postgres with a stub of Supabase auth/storage.
# Usage: supabase/tests/run_tests.sh   (env: PGHOST=/tmp PGPORT=54329 PGUSER=postgres)
set -u
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUPA="$(dirname "$HERE")"
DB=aa_db_test
SEEDDB=aa_db_seed_test
fail=0
psqlq() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

fresh_db() { # name
  psql -X -q -d postgres -c "drop database if exists $1 with (force)" -c "create database $1" >/dev/null || return 1
  psqlq -d "$1" -f "$HERE/00_supabase_stub.sql" >/dev/null || return 1
  for m in "$SUPA"/migrations/*.sql; do
    psqlq -d "$1" -f "$m" >/dev/null || { echo "FAIL  migration $(basename "$m")"; return 1; }
    echo "ok    migration $(basename "$m")"
  done
}

echo "== building $DB =="
fresh_db "$DB" || { echo "Setup failed"; exit 1; }
psqlq -d "$DB" -f "$HERE/fixtures.sql" >/dev/null || { echo "FAIL  fixtures"; exit 1; }

echo "== tests =="
for f in "$HERE"/test_*.sql; do
  name="$(basename "$f")"
  if out=$(psqlq -d "$DB" -f "$f" 2>&1); then
    echo "PASS  $name"
  else
    echo "FAIL  $name"; echo "$out" | sed 's/^/      /'; fail=1
  fi
done

if [ -f "$SUPA/seed.sql" ]; then
  echo "== seed.sql against a fresh schema =="
  if fresh_db "$SEEDDB" >/dev/null && out=$(psqlq -d "$SEEDDB" -f "$SUPA/seed.sql" 2>&1); then
    echo "PASS  seed.sql loads"
    psql -X -q -t -d "$SEEDDB" -c "select 'buildings='||(select count(*) from buildings)||' floors='||(select count(*) from floors)||' nodes='||(select count(*) from route_nodes)||' edges='||(select count(*) from route_edges)||' audit_rows='||(select count(*) from audit_events)"
  else
    echo "FAIL  seed.sql"; echo "${out:-}" | sed 's/^/      /'
  fi
  psql -X -q -d postgres -c "drop database if exists $SEEDDB with (force)" >/dev/null
else
  echo "(no supabase/seed.sql yet - skipped)"
fi

[ $fail -eq 0 ] && echo "ALL PASSED" || echo "SOME FAILED"
exit $fail
