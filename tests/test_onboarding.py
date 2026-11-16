import pytest

from app.core.config import Settings
from app.core.demo_repository import DemoRepository
from app.main import create_app


def test_onboarding_route_is_exposed_in_openapi():
    app = create_app(Settings(_env_file=None, app_env="test"))
    paths = app.openapi()["paths"]

    assert "/api/v1/me/onboarding/complete" in paths
    assert "post" in paths["/api/v1/me/onboarding/complete"]


@pytest.mark.asyncio
async def test_demo_repository_marks_onboarding_once():
    repository = DemoRepository()
    user_id = next(iter(repository.store.users))

    assert await repository.onboarding_completed(user_id) is False
    assert await repository.complete_onboarding(user_id) is True
    first = repository.store.users[user_id]["onboardingCompletedAt"]
    assert await repository.onboarding_completed(user_id) is True

    await repository.complete_onboarding(user_id)
    assert repository.store.users[user_id]["onboardingCompletedAt"] == first
