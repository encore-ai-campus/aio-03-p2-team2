from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.api import APIError, success
from app.core.auth import current_user_id, require_current_user
from app.core.repositories import get_repository
from .schemas import LoginRequest, NotificationConsentPatch, ProfilePatch, SignupRequest
from .service import SupabaseAuthClient

auth_router = APIRouter(prefix="/auth", tags=["auth"])
users_router = APIRouter(tags=["users"], dependencies=[Depends(require_current_user)])
# Keep the old module-level name available for callers that imported it before
# the public auth router was introduced.
router = users_router


@auth_router.post("/signup", operation_id="signUp")
async def signup(payload: SignupRequest, request: Request):
    """Create a Supabase Auth account and return its session when available."""

    result = await SupabaseAuthClient(request.app.state.settings).signup(payload)
    return success(result, request, status_code=201)


@auth_router.post("/login", operation_id="login")
async def login(payload: LoginRequest, request: Request):
    """Sign in with email/password and return Supabase access and refresh tokens."""

    result = await SupabaseAuthClient(request.app.state.settings).login(payload)
    return success(result, request)


def authenticated_self_user(user_id: str, request: Request) -> str:
    current = current_user_id(request)
    if current != user_id:
        raise APIError(403, "USER_FORBIDDEN", "본인 사용자 정보만 변경할 수 있습니다.")
    return current


async def current_user(request: Request) -> dict:
    """Return the authenticated application user for frontend `/me` calls."""

    user = await get_repository(request).user(current_user_id(request))
    if not user:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return user


@users_router.get("/me", operation_id="getCurrentUser")
async def get_current_user(request: Request):
    """Frontend-friendly alias that does not require the user id in the URL.

    `onboardingCompleted` is true/false, or null before db/002_onboarding.sql is applied.
    """

    user = await current_user(request)
    completed = await get_repository(request).onboarding_completed(user["id"])
    return success({**user, "onboardingCompleted": completed}, request)


@users_router.post("/me/onboarding/complete", operation_id="completeCurrentUserOnboarding")
async def complete_current_user_onboarding(request: Request):
    """Mark onboarding as finished (saved or skipped) so it is not shown again."""

    user = await current_user(request)
    await get_repository(request).complete_onboarding(user["id"])
    return success({"onboardingCompleted": True}, request)


@users_router.patch("/me/profile", operation_id="updateCurrentUserProfile")
async def update_current_user_profile(payload: ProfilePatch, request: Request):
    user_id = current_user_id(request)
    user = await get_repository(request).update_profile(
        user_id,
        payload.model_dump(by_alias=True, exclude_none=True),
    )
    if not user:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(user, request)


@users_router.patch("/me/notification-consents", operation_id="updateCurrentUserNotificationConsents")
async def update_current_user_consents(payload: NotificationConsentPatch, request: Request):
    user_id = current_user_id(request)
    consents = await get_repository(request).update_consents(
        user_id,
        payload.model_dump(by_alias=True, exclude_none=True),
    )
    if consents is None:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(consents, request)


@users_router.get("/users/{user_id}", operation_id="getUser")
async def get_user(user_id: str, request: Request):
    repository = get_repository(request)
    authenticated_self_user(user_id, request)
    user = await repository.user(user_id)
    if not user:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(user, request)


@users_router.patch("/users/{user_id}/profile", operation_id="updateUserProfile")
async def update_profile(user_id: str, payload: ProfilePatch, request: Request):
    repository = get_repository(request)
    authenticated_self_user(user_id, request)
    user = await repository.update_profile(user_id, payload.model_dump(by_alias=True, exclude_none=True))
    if not user:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(user, request)


@users_router.patch("/users/{user_id}/notification-consents", operation_id="updateNotificationConsents")
async def update_consents(user_id: str, payload: NotificationConsentPatch, request: Request):
    repository = get_repository(request)
    authenticated_self_user(user_id, request)
    consents = await repository.update_consents(user_id, payload.model_dump(by_alias=True, exclude_none=True))
    if consents is None:
        raise APIError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return success(consents, request)
