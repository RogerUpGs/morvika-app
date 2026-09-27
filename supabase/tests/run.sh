#!/usr/bin/env bash
# Kjører migrasjonen og tilgangstestene mot en lokal PostgreSQL.
# Bruk: PGHOST=... PGPORT=... supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=morvika_test
psql -U postgres -qc "drop database if exists $DB" -c "create database $DB"
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f tests/supabase_stub.sql
# pg_net finnes ikke lokalt; stubben lager net.http_post
for f in migrations/*.sql; do grep -v "^create extension if not exists pg_net" "$f" | psql -U postgres -d $DB -q -v ON_ERROR_STOP=1; done
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f tests/rls_test.sql 2>&1 | grep -v "does not exist, skipping" | sed 's/^psql:[^ ]* NOTICE:  //;s/^NOTICE:  //'
