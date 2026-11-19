from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.core.auth import CurrentUser, require_current_user
from app.features.alerts.repository import AlertRepositoryMixin
from app.features.alerts.router import router


def test_alert_pages_preserve_scope_order_and_total():
    class Pool:
        queries = []

        async def fetchval(self, sql, *args):
            assert args == ("usr_member", "unread", "rain")
            return 51

        async def fetch(self, sql, *args):
            self.queries.append((sql, args))
            return [{
                "id": "alert_older", "type": "rain", "festival_id": "fst", "group_id": "grp",
                "severity": "warning", "title": "비 예보", "message": "비가 옵니다.",
                "status": "unread", "choice": None, "created_at": datetime.now(timezone.utc), "answered_at": None,
            }]

    pool = Pool()

    class Repository(AlertRepositoryMixin):
        def _pool(self):
            return pool

    async def authenticate(request: Request):
        request.state.current_user = CurrentUser(id="usr_member", auth_user_id="test", claims={})
        return request.state.current_user

    app = FastAPI()
    app.include_router(router)
    app.state.repository = Repository(None)
    app.dependency_overrides[require_current_user] = authenticate
    with TestClient(app) as client:
        second = client.get("/alerts?page=2&pageSize=50&status=unread&type=rain")
        beyond = client.get("/alerts?page=3&pageSize=50&status=unread&type=rain")

    assert second.status_code == 200
    assert [item["id"] for item in second.json()["data"]["items"]] == ["alert_older"]
    assert second.json()["data"]["total"] == 51
    assert beyond.json()["data"] == {"items": [], "page": 3, "pageSize": 50, "total": 51}
    [(sql, args)] = pool.queries
    assert "where user_id=$1 and status=$2 and type=$3" in sql
    assert "order by created_at desc, id desc limit $4 offset $5" in sql
    assert args == ("usr_member", "unread", "rain", 50, 50)
