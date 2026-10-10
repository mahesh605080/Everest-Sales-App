"""Alembic owns only the "platform" schema. The web app's tables in "public" are managed by its own numbered SQL files."""
from alembic import context
from sqlalchemy import create_engine, text

from app import models  # noqa: F401  registers every table on Base.metadata
from app.config import get_settings
from app.db import SCHEMA, Base

target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    return not (type_ == "table" and getattr(obj, "schema", None) != SCHEMA)


def run():
    engine = create_engine(get_settings().database_url)
    with engine.connect() as conn:
        conn.execute(text(f"create schema if not exists {SCHEMA}"))
        conn.commit()
        context.configure(connection=conn, target_metadata=target_metadata, version_table_schema=SCHEMA, include_schemas=True,
                          include_object=include_object, compare_type=True, transaction_per_migration=True)
        with context.begin_transaction():
            context.run_migrations()


run()
