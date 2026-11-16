"""Regression guard for SQL Editor deployments independent of search_path."""
from pathlib import Path
import re

SQL=Path(__file__).resolve().parents[1]/'docs/sql/001_agent_postgres.sql'


def test_checkpoint_table_references_are_schema_qualified():
    text=SQL.read_text(encoding='utf-8')
    assert not re.search(r'\b(?:FROM|TABLE|ON)\s+(?:checkpoint_migrations|checkpoints|checkpoint_blobs|checkpoint_writes)\b',text,re.I)
    assert 'SET LOCAL search_path' not in text


def test_migration_version_table_created_before_read():
    text=SQL.read_text(encoding='utf-8')
    assert text.index('CREATE TABLE IF NOT EXISTS agent_storage.checkpoint_migrations') < text.index('SELECT max(v) FROM agent_storage.checkpoint_migrations')
