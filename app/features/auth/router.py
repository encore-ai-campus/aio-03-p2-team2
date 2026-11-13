from __future__ import annotations

from fastapi import APIRouter, Header, Request

from app.core.api import APIError, success
from app.core.schemas import NotificationConsentPatch, ProfilePatch
from app.core.store import store

router = APIRouter(tags=["users"])


def demo_user(x_demo_user_id: str | None) -> str:
    if not x_demo_user_id or not store.user(x_demo_user_id):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return x_demo_user_id


def self_user(user_id: str, x_demo_user_id: str | None) -> str:
    current = demo_user(x_demo_user_id)
    if current != user_id:
        raise APIError(403, "DEMO_USER_FORBIDDEN", "본인 데모 사용자만 변경할 수 있습니다.")
    return current


@router.get("/users/{user_id}", operation_id="getUser")
def get_user(user_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    self_user(user_id, x_demo_user_id)
    user = store.user(user_id)
    if not user:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(user, request)


@router.patch("/users/{user_id}/profile", operation_id="updateUserProfile")
def update_profile(user_id: str, payload: ProfilePatch, request: Request, x_demo_user_id: str | None = Header(default=None)):
    self_user(user_id, x_demo_user_id)
    with store.lock:
        user = store.users.get(user_id)
        if not user:
            raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
        user["profile"].update(payload.model_dump(by_alias=True, exclude_none=True))
        return success(user, request)


@router.patch("/users/{user_id}/notification-consents", operation_id="updateNotificationConsents")
def update_consents(user_id: str, payload: NotificationConsentPatch, request: Request, x_demo_user_id: str | None = Header(default=None)):
    self_user(user_id, x_demo_user_id)
    with store.lock:
        user = store.users.get(user_id)
        if not user:
            raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
        user["notificationConsent"].update(payload.model_dump(by_alias=True, exclude_none=True))
        return success(user["notificationConsent"], request)
