import os
import re
import sys
from pathlib import Path

import psycopg2


requested = sys.argv[1] if len(sys.argv) > 1 else ""
if not re.fullmatch(r"\d{14}_[a-z0-9_]+\.sql", requested):
    raise SystemExit("Informe o nome exato de uma migração versionada.")

database_url = os.environ.get("DATABASE_URL")
if not database_url:
    raise SystemExit("DATABASE_URL não configurada.")

migrations_directory = (Path.cwd() / "supabase" / "migrations").resolve()
migration_path = (migrations_directory / requested).resolve()
if migration_path.parent != migrations_directory:
    raise SystemExit("A migração precisa estar em supabase/migrations.")

version, name = requested.removesuffix(".sql").split("_", 1)
sql = migration_path.read_text(encoding="utf-8")

with psycopg2.connect(database_url, sslmode="require") as connection:
    with connection.cursor() as cursor:
        cursor.execute("select pg_advisory_xact_lock(73462901)")
        cursor.execute(
            "select version from supabase_migrations.schema_migrations where version = %s",
            (version,),
        )
        if cursor.fetchone():
            print(f'{{"version":"{version}","status":"already_applied"}}')
        else:
            cursor.execute(sql)
            cursor.execute(
                """
                insert into supabase_migrations.schema_migrations
                    (version, statements, name)
                values (%s, %s::text[], %s)
                """,
                (version, [sql], name),
            )
            print(f'{{"version":"{version}","status":"applied"}}')
