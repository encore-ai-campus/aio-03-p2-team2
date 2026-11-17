from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Support both ``python -m app.sync_worker`` and direct IDE/script execution.
if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.core.database import Database
from app.core.repositories import SupabaseRepository
from app.features.sync.worker import ExternalSyncWorker


async def main() -> None:
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required to run the external sync worker")
    database = Database(settings)
    await database.connect()
    if database.pool is None:
        raise RuntimeError(database.error or "Database connection failed")
    worker = ExternalSyncWorker(SupabaseRepository(database), settings)
    auth_token = database.bind_auth_claims(
        {"sub": "external-sync-worker", "app_metadata": {"role": "service_role"}}
    )
    try:
        await worker.run_forever()
    finally:
        await worker.close()
        database.reset_auth_claims(auth_token)
        await database.close()


if __name__ == "__main__":
    asyncio.run(main())

