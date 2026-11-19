from datetime import time
from unittest.mock import AsyncMock

import pytest

from app.features.auth.repository import AuthRepositoryMixin


class Repo(AuthRepositoryMixin):
    def __init__(self, pool):
        self.pool = pool

    def _pool(self):
        return self.pool


def row(uid, empty=False):
    values = {key: None for key in ("interests", "budget_manwon", "travel_style", "mbti", "preferred_party_size",
        "available_from", "default_join_mode", "gender", "age_band", "push", "email", "risk_alert")}
    if not empty:
        values.update(interests=["사진"], budget_manwon=8, travel_style="여유롭게", mbti=["ENFP"], preferred_party_size=4,
            available_from=time(13, 30), default_join_mode="instant", gender="여성", age_band="20대", push=True, email=False, risk_alert=True)
    return {"id": uid, "display_name": uid, "avatar_url": None, **values}


@pytest.mark.asyncio
@pytest.mark.parametrize("exclude_id", [None, "me"])
async def test_batch_users_matches_individual_views_without_repeated_reads(exclude_id):
    records = [row("a"), row("b", empty=True)]
    pool = type("Pool", (), {})()
    pool.fetch = AsyncMock(return_value=records)
    pool.fetchrow = AsyncMock(side_effect=records)
    repo = Repo(pool)
    actual = await repo.users(exclude_id=exclude_id)
    pool.fetch.assert_awaited_once()
    pool.fetchrow.assert_not_awaited()
    sql, *args = pool.fetch.call_args.args
    assert "where u.status = 'active'" in sql and "order by u.id" in sql
    assert args == ([exclude_id] if exclude_id else [])
    assert ("u.id <> $1" in sql) == bool(exclude_id)
    assert actual == [await repo.user(record["id"]) for record in records]
    assert actual[1]["notificationConsent"] == {"push": False, "email": False, "riskAlert": False}


@pytest.mark.asyncio
async def test_empty_user_list_needs_only_one_query():
    pool = type("Pool", (), {"fetch": AsyncMock(return_value=[])})()
    assert await Repo(pool).users() == []
    pool.fetch.assert_awaited_once()
