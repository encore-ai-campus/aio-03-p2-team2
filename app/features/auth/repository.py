from __future__ import annotations

from typing import Any

import asyncpg

from app.core.repository import RepositoryBase, RepositoryError, _hhmm, _time


class AuthRepositoryMixin(RepositoryBase):
    async def user_by_auth_id(self, auth_user_id: str) -> dict | None:
        row = await self._pool().fetchrow(
            """
            select u.id, u.display_name, u.avatar_url,
                   p.interests, p.budget_manwon, p.travel_style, p.mbti,
                   p.preferred_party_size, p.available_from, p.default_join_mode,
                   p.gender, p.age_band,
                   n.push, n.email, n.risk_alert
            from users u
            left join user_profiles p on p.user_id = u.id
            left join notification_consents n on n.user_id = u.id
            where u.auth_user_id = $1 and u.status = 'active'
            """,
            auth_user_id,
        )
        return self._user_view(row) if row else None

    async def user(self, user_id: str) -> dict | None:
        row = await self._pool().fetchrow(
            """
            select u.id, u.display_name, u.avatar_url,
                   p.interests, p.budget_manwon, p.travel_style, p.mbti,
                   p.preferred_party_size, p.available_from, p.default_join_mode,
                   p.gender, p.age_band,
                   n.push, n.email, n.risk_alert
            from users u
            left join user_profiles p on p.user_id = u.id
            left join notification_consents n on n.user_id = u.id
            where u.id = $1 and u.status = 'active'
            """,
            user_id,
        )
        return self._user_view(row) if row else None

    async def users(self, *, exclude_id: str | None = None) -> list[dict]:
        query = "select id from users where status = 'active'"
        args: list[Any] = []
        if exclude_id:
            query += " and id <> $1"
            args.append(exclude_id)
        query += " order by id"
        rows = await self._pool().fetch(query, *args)
        result = []
        for row in rows:
            item = await self.user(row["id"])
            if item:
                result.append(item)
        return result

    @staticmethod
    def _user_view(row: asyncpg.Record) -> dict:
        return {
            "id": row["id"],
            "displayName": row["display_name"],
            "avatarUrl": row["avatar_url"],
            "profile": {
                "interests": row["interests"] or [],
                "budgetManwon": row["budget_manwon"],
                "travelStyle": row["travel_style"],
                "mbti": row["mbti"] or [],
                "preferredPartySize": row["preferred_party_size"],
                "availableFrom": _hhmm(row["available_from"]),
                "defaultJoinMode": row["default_join_mode"] or "approval",
                "gender": row["gender"],
                "ageBand": row["age_band"],
            },
            "notificationConsent": {
                "push": bool(row["push"]) if row["push"] is not None else False,
                "email": bool(row["email"]) if row["email"] is not None else False,
                "riskAlert": bool(row["risk_alert"]) if row["risk_alert"] is not None else False,
            },
        }

    async def update_profile(self, user_id: str, values: dict[str, Any]) -> dict | None:
        if not await self.user(user_id):
            return None
        if not values:
            return await self.user(user_id)
        mapping = {
            "interests": "interests",
            "budgetManwon": "budget_manwon",
            "travelStyle": "travel_style",
            "mbti": "mbti",
            "preferredPartySize": "preferred_party_size",
            "availableFrom": "available_from",
            "defaultJoinMode": "default_join_mode",
            "gender": "gender",
            "ageBand": "age_band",
        }
        fields = [(mapping[key], value) for key, value in values.items() if key in mapping]
        if not fields:
            return await self.user(user_id)
        assignments = []
        args: list[Any] = [user_id]
        for index, (column, value) in enumerate(fields, start=2):
            assignments.append(f"{column} = ${index}")
            args.append(_time(value) if column == "available_from" else value)
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    "insert into user_profiles (user_id) values ($1) on conflict (user_id) do nothing",
                    user_id,
                )
                await connection.execute(
                    f"update user_profiles set {', '.join(assignments)}, updated_at = now() where user_id = $1",
                    *args,
                )
        return await self.user(user_id)

    async def onboarding_completed(self, user_id: str) -> bool | None:
        """Return onboarding completion; None until db/002_onboarding.sql is applied."""
        try:
            completed_at = await self._pool().fetchval(
                "select onboarding_completed_at from user_profiles where user_id = $1",
                user_id,
            )
        except asyncpg.UndefinedColumnError:
            return None
        return completed_at is not None

    async def complete_onboarding(self, user_id: str) -> bool:
        """Mark onboarding as done once (saved or skipped); repeated calls keep the first time."""
        try:
            async with self._pool().acquire() as connection:
                async with connection.transaction():
                    await connection.execute(
                        "insert into user_profiles (user_id) values ($1) on conflict (user_id) do nothing",
                        user_id,
                    )
                    await connection.execute(
                        "update user_profiles set onboarding_completed_at = coalesce(onboarding_completed_at, now()), updated_at = now() where user_id = $1",
                        user_id,
                    )
        except asyncpg.UndefinedColumnError as exc:
            raise RepositoryError(
                "ONBOARDING_MIGRATION_REQUIRED",
                "온보딩 완료 컬럼이 없습니다. db/002_onboarding.sql을 먼저 적용해 주세요.",
                503,
            ) from exc
        return True

    async def update_consents(self, user_id: str, values: dict[str, Any]) -> dict | None:
        if not await self.user(user_id):
            return None
        mapping = {"push": "push", "email": "email", "riskAlert": "risk_alert"}
        fields = [(mapping[key], value) for key, value in values.items() if key in mapping]
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    "insert into notification_consents (user_id) values ($1) on conflict (user_id) do nothing",
                    user_id,
                )
                if fields:
                    assignments = []
                    args: list[Any] = [user_id]
                    for index, (column, value) in enumerate(fields, start=2):
                        assignments.append(f"{column} = ${index}")
                        args.append(value)
                    await connection.execute(
                        f"update notification_consents set {', '.join(assignments)}, updated_at = now() where user_id = $1",
                        *args,
                    )
        row = await self._pool().fetchrow(
            "select push, email, risk_alert from notification_consents where user_id = $1",
            user_id,
        )
        return {"push": row["push"], "email": row["email"], "riskAlert": row["risk_alert"]} if row else None
