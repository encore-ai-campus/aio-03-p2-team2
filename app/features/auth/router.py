from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.api import APIError, success
from app.core.auth import current_user_id, require_current_user
from app.core.repositories import get_repository
from .schemas import NotificationConsentPatch, ProfilePatch

router = APIRouter(tags=["users"], dependencies=[Depends(require_current_user)])


def authenticated_self_user(user_id: str, request: Request) -> str:
    current = current_user_id(request)
    if current != user_id:
        raise APIError(403, "USER_FORBIDDEN", "본인 사용자 정보만 변경할 수 있습니다.")
    return current


@router.get("/users/{user_id}", operation_id="getUser")
async def get_user(user_id: str, request: Request):
    repository = get_repository(request)
    authenticated_self_user(user_id, request)
    user = await repository.user(user_id)
    if not user:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(user, request)


@router.patch("/users/{user_id}/profile", operation_id="updateUserProfile")
async def update_profile(user_id: str, payload: ProfilePatch, request: Request):
    repository = get_repository(request)
    authenticated_self_user(user_id, request)
    user = await repository.update_profile(user_id, payload.model_dump(by_alias=True, exclude_none=True))
    if not user:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(user, request)


@router.patch("/users/{user_id}/notification-consents", operation_id="updateNotificationConsents")
async def update_consents(user_id: str, payload: NotificationConsentPatch, request: Request):
    repository = get_repository(request)
    authenticated_self_user(user_id, request)
    consents = await repository.update_consents(user_id, payload.model_dump(by_alias=True, exclude_none=True))
    if consents is None:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(consents, request)
