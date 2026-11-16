"""Explicit, process-local fixtures for workflow_console --mode demo only."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.core.demo_repository import DemoRepository
from app.core.repository import RepositoryError
from app.features.agents.tools import observed


class SandboxRepository(DemoRepository):
    async def create_group(self, user_id, payload):
        result = await super().create_group(user_id, payload)
        # Match the live recruitment's initial schedule, whose end time is not yet planned.
        group = self.store.groups[result["id"]]
        group["schedule"]["current"].pop("endTime", None)
        group["schedule"]["items"] = [deepcopy(group["schedule"]["current"])]
        return deepcopy(group)

    async def create_join_request(self, group_id, user_id, message):
        group = self.store.groups[group_id]
        if any(member["userId"] == user_id for member in group["members"]):
            raise RepositoryError("ALREADY_MEMBER", "이미 참여 중입니다.")
        if any(item["userId"] == user_id and item["status"] == "pending" for item in group["joinRequests"]):
            raise RepositoryError("JOIN_REQUEST_ALREADY_EXISTS", "이미 신청했습니다.")
        if len(group["members"]) >= group["capacity"]:
            raise RepositoryError("GROUP_CAPACITY_EXCEEDED", "정원이 가득 찼습니다.")
        item = {"id":f"join_{uuid4().hex}", "userId":user_id, "groupId":group_id, "message":message, "status":"pending"}
        group["joinRequests"].append(item)
        return {"request":deepcopy(item),"membership":None,"group":deepcopy(group)}

    async def approve_join_request(self, group_id, request_id, leader_id, version):
        group = self.owned(group_id, leader_id)
        self.version(group, version)
        item = next((item for item in group["joinRequests"] if item["id"] == request_id), None)
        if not item or item["status"] != "pending":
            raise RepositoryError("JOIN_REQUEST_NOT_PENDING", "대기 중인 신청이 아닙니다.")
        if len(group["members"]) >= group["capacity"]:
            raise RepositoryError("GROUP_CAPACITY_EXCEEDED", "정원이 가득 찼습니다.")
        item["status"] = "approved"
        member = {"userId":item["userId"], "role":"member"}
        group["members"].append(member)
        group["version"] += 1
        self.store.update_status(group)
        return {"membership":deepcopy(member),"group":deepcopy(group)}

    async def join_requests(self, group_id, *, status=None, offset=0, limit=20):
        items = [deepcopy(item) for item in self.store.groups[group_id]["joinRequests"] if not status or item["status"] == status]
        return items[offset:offset+limit], len(items)

    async def alerts(self, user_id, status=None, alert_type=None):
        return [deepcopy(item) for item in self.store.alerts.values() if item.get("userId") == user_id
                and (not status or item["status"] == status) and (not alert_type or item["type"] == alert_type)]

    async def alert(self, alert_id, user_id):
        item = self.store.alerts.get(alert_id)
        return deepcopy(item) if item and item.get("userId") == user_id else None


class SandboxWeather:
    def __init__(self, repository): self.repository = repository

    async def check(self, group_id, *, simulate=False):
        group = await self.repository.group(group_id)
        day = group["schedule"]["current"]["date"]
        evidence = observed("terminal_sandbox_weather", {"date":day,"precipitationProbability":90 if simulate else 20,"weatherCode":95 if simulate else 1}, mode="simulation")
        count = 0
        if simulate:
            for member in group["members"]:
                user = await self.repository.user(member["userId"])
                if not user["notificationConsent"].get("riskAlert"):
                    continue
                key = f"sandbox-weather:{group_id}:{group['festivalId']}:{day}:{member['userId']}"
                if key in self.repository.store.alerts:
                    continue
                self.repository.store.alerts[key] = dict(id=key, userId=member["userId"], groupId=group_id,
                    festivalId=group["festivalId"], type="rain", severity="warning", title="[테스트] 악천후 알림",
                    message="격리 시험용 악천후입니다.", status="unread", choice=None, isTest=True, evidence=evidence,
                    createdAt=datetime.now(timezone.utc).isoformat(), answeredAt=None)
                count += 1
        return {"risk":simulate,"createdAlertCount":count,"weather":evidence,"isTest":True}


class RepairDemoModel:
    """Inject one declared bad candidate, then let the real graph repair it."""
    def __init__(self, delegate):
        self.delegate = delegate
        self.inject_next_error = False

    def __getattr__(self, name): return getattr(self.delegate, name)

    async def generate(self, state):
        candidate = await self.delegate.generate(state)
        if self.inject_next_error and state["intent"] == "scheduling" and candidate.get("items"):
            self.inject_next_error = False
            candidate = deepcopy(candidate)
            candidate["items"][0]["time"] = "00:00"
        return candidate


def make_sandbox(provider):
    from app.core.auth import JWTVerifier
    from app.core.config import Settings
    from app.features.agents.providers import OpenAIModel, RuleBasedModel
    from app.main import create_app
    # These are explicit local-test facilities, as in the existing agent console.
    from tests.auth_helpers import ISSUER, SECRET, SUBJECTS, token_headers
    from tests.ephemeral_storage import EphemeralAgentStorage

    source = Settings()
    config = source.model_copy(update={"database_url":None,"app_env":"test",
        "agent_model_provider":provider,"agent_weather_provider":"demo","tour_api_service_key":None})
    repo = SandboxRepository()
    day = datetime.now(timezone(timedelta(hours=9))).date()+timedelta(days=1)
    # Same dates make alternative-festival selection repeatable without inventing live facts.
    for festival in repo.store.festivals.values():
        festival.update(startDate=day.isoformat(),endDate=(day+timedelta(days=2)).isoformat(),riskStatus="normal",
            operatingHours=[{"date":(day+timedelta(days=index)).isoformat(),"open":"09:00","close":"22:00"} for index in range(3)])
    model = OpenAIModel(source.openai_api_key.get_secret_value() if source.openai_api_key else "", source.openai_model) if provider == "openai" else RuleBasedModel()
    wrapped = RepairDemoModel(model)
    app = create_app(config, repository=repo, model=wrapped, agent_storage=EphemeralAgentStorage())
    app.state.jwt_verifier = JWTVerifier(Settings(_env_file=None,supabase_url="https://isolated-test.supabase.co",supabase_jwt_secret=SECRET,supabase_jwt_issuer=ISSUER))

    async def lookup(subject):
        user_id = next((user_id for user_id, value in SUBJECTS.items() if value == subject), None)
        return await repo.user(user_id) if user_id else None

    repo.user_by_auth_id = lookup
    accounts = {label:{"token":token_headers(user_id, exp=datetime.now(timezone.utc)+timedelta(hours=8))["Authorization"][7:],"id":user_id}
                for label,user_id in (("A","usr_demo_02"),("B","usr_demo_01"))}
    return app, accounts, wrapped, SandboxWeather(repo)
