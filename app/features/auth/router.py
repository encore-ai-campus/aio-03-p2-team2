from __future__ import annotations

from fastapi import APIRouter, Header, Request

from app.core.api import APIError, success
from app.core.repositories import SupabaseRepository, get_repository
from app.core.schemas import NotificationConsentPatch, ProfilePatch

router = APIRouter(tags=["users"])


async def demo_user(value: str | None, repository: SupabaseRepository) -> str:
    if not value or not await repository.user(value):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return value


async def self_user(user_id: str, value: str | None, repository: SupabaseRepository) -> str:
    current = await demo_user(value, repository)
    if current != user_id:
        raise APIError(403, "DEMO_USER_FORBIDDEN", "본인 사용자만 변경할 수 있습니다.")
    return current


@router.get("/users/{user_id}", operation_id="getUser")
async def get_user(user_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    await self_user(user_id, x_demo_user_id, repository)
    user = await repository.user(user_id)
    if not user:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(user, request)


@router.patch("/users/{user_id}/profile", operation_id="updateUserProfile")
async def update_profile(user_id: str, payload: ProfilePatch, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    await self_user(user_id, x_demo_user_id, repository)
    user = await repository.update_profile(user_id, payload.model_dump(by_alias=True, exclude_none=True))
    if not user:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(user, request)


@router.patch("/users/{user_id}/notification-consents", operation_id="updateNotificationConsents")
async def update_consents(user_id: str, payload: NotificationConsentPatch, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    await self_user(user_id, x_demo_user_id, repository)
    consents = await repository.update_consents(user_id, payload.model_dump(by_alias=True, exclude_none=True))
    if consents is None:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(consents, request)
