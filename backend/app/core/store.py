from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from threading import RLock
from uuid import uuid4


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class InMemoryStore:
    """Legacy demo fixture kept for isolated UI/mock experiments.

    Runtime feature routers do not import this store; they use the domain
    repositories backed by the Supabase PostgreSQL pool.
    """

    def __init__(self) -> None:
        self.lock = RLock()
        self.users: dict[str, dict] = {}
        self.festivals: dict[str, dict] = {}
        self.groups: dict[str, dict] = {}
        self.alerts: dict[str, dict] = {}
        self.matching_runs: dict[str, dict] = {}
        self.jobs: dict[str, dict] = {}
        self._seed()

    def _seed(self) -> None:
        users = [
            ("usr_demo_01", "로컬탐험 하늘", ["음악", "사진", "문화"], 7, "여유롭게", ["INFJ"], "15:00"),
            ("usr_demo_02", "페스타메이트 민수", ["공연", "미식", "사진"], 8, "활동적으로", ["ENFP"], "13:00"),
            ("usr_demo_03", "주말여행 지아", ["문화", "공연"], 10, "여유롭게", [], "10:00"),
        ]
        for user_id, name, interests, budget, style, mbti, available_from in users:
            self.users[user_id] = {
                "id": user_id,
                "displayName": name,
                "avatarUrl": None,
                "profile": {
                    "interests": interests,
                    "budgetManwon": budget,
                    "travelStyle": style,
                    "mbti": mbti,
                    "preferredPartySize": 4,
                    "availableFrom": available_from,
                    "defaultJoinMode": "approval",
                },
                "notificationConsent": {"push": True, "email": False, "riskAlert": True},
            }

        self.add_festival(
            {
                "id": "fst_demo_music",
                "name": "바다빛 음악축제",
                "region": "부산",
                "city": "해운대구",
                "startDate": "2026-11-14",
                "endDate": "2026-11-15",
                "category": "음악",
                "description": "바다와 함께 즐기는 라이브 공연과 문화 프로그램",
                "tags": ["음악", "공연", "바다"],
                "status": "upcoming",
                "source": "demo",
                "sourceUpdatedAt": "2026-11-12T06:00:00Z",
                "venue": {"name": "해운대 이벤트광장", "address": "부산 해운대구", "latitude": 35.1587, "longitude": 129.1604},
                "operatingHours": [{"date": "2026-11-14", "open": "10:00", "close": "21:00"}, {"date": "2026-11-15", "open": "10:00", "close": "20:00"}],
                "riskStatus": "normal",
            }
        )
        self.add_festival(
            {
                "id": "fst_demo_food",
                "name": "부산 바다 미식주간",
                "region": "부산",
                "city": "수영구",
                "startDate": "2026-11-21",
                "endDate": "2026-11-22",
                "category": "미식",
                "description": "지역 맛집과 바다 풍경을 함께 만나는 미식 행사",
                "tags": ["미식", "부산", "바다"],
                "status": "upcoming",
                "source": "demo",
                "sourceUpdatedAt": "2026-11-12T06:00:00Z",
                "venue": {"name": "광안리 문화광장", "address": "부산 수영구", "latitude": 35.1532, "longitude": 129.1188},
                "operatingHours": [{"date": "2026-11-21", "open": "11:00", "close": "20:00"}, {"date": "2026-11-22", "open": "11:00", "close": "18:00"}],
                "riskStatus": "normal",
            }
        )

    def add_festival(self, festival: dict) -> dict:
        item = deepcopy(festival)
        item.setdefault("id", new_id("fst"))
        item.setdefault("sourceUpdatedAt", now_iso())
        self.festivals[item["id"]] = item
        return deepcopy(item)

    def user(self, user_id: str) -> dict | None:
        return deepcopy(self.users.get(user_id))

    def festival(self, festival_id: str) -> dict | None:
        item = self.festivals.get(festival_id)
        return self.festival_view(item) if item else None

    @staticmethod
    def festival_view(item: dict) -> dict:
        result = deepcopy(item)
        today = date.today().isoformat()
        if result["endDate"] < today:
            result["status"] = "past"
        elif result["startDate"] > today:
            result["status"] = "upcoming"
        else:
            result["status"] = "live"
        return result

    def festivals_view(self) -> list[dict]:
        return [self.festival_view(item) for item in self.festivals.values()]

    def group(self, group_id: str) -> dict | None:
        item = self.groups.get(group_id)
        return deepcopy(item) if item else None

    def group_ref(self, group_id: str) -> dict | None:
        return self.groups.get(group_id)

    def serialize_group(self, group: dict, include_comments: bool = True) -> dict:
        item = deepcopy(group)
        item["memberCount"] = len(item["members"])
        item["pendingRequestCount"] = sum(req["status"] == "pending" for req in item["joinRequests"])
        item.pop("joinRequests", None)
        if not include_comments:
            item.pop("comments", None)
        return item

    def create_group(self, user_id: str, payload: dict) -> dict:
        group_id = new_id("grp")
        timestamp = now_iso()
        festival = self.festivals[payload["festivalId"]]
        group = {
            "id": group_id,
            "festivalId": payload["festivalId"],
            "title": payload["title"],
            "postBody": payload["postBody"],
            "leaderId": user_id,
            "joinMode": payload["joinMode"],
            "capacity": payload["capacity"],
            "status": "open",
            "members": [{"userId": user_id, "role": "leader", "joinedAt": timestamp}],
            "joinRequests": [],
            "comments": [],
            "messages": [],
            "schedule": {
                "version": 1,
                "current": {"date": festival["startDate"], "time": "13:00", "label": festival["name"], "description": "모임 기본 일정"},
                "validation": None,
                "proposals": [],
            },
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "version": 1,
        }
        self.groups[group_id] = group
        return self.serialize_group(group)

    def member(self, group: dict, user_id: str) -> dict | None:
        return next((member for member in group["members"] if member["userId"] == user_id), None)

    def update_status(self, group: dict) -> None:
        if group["status"] not in {"cancelled", "closed"}:
            group["status"] = "full" if len(group["members"]) >= group["capacity"] else "open"

    def add_message(self, group: dict, user_id: str | None, text: str, message_type: str = "user") -> dict:
        message = {
            "id": new_id("msg"),
            "groupId": group["id"],
            "sender": self.users[user_id] | {"profile": {}, "notificationConsent": {}} if user_id else {"id": "system", "displayName": "FestaMate", "avatarUrl": None},
            "type": message_type,
            "text": text,
            "createdAt": now_iso(),
        }
        message["sender"] = {key: message["sender"][key] for key in ("id", "displayName", "avatarUrl")}
        group["messages"].append(message)
        return deepcopy(message)

    def create_alert(self, user_id: str, alert: dict) -> dict:
        item = {"id": new_id("alt"), "status": "unread", "choice": None, "createdAt": now_iso(), **alert, "userId": user_id}
        self.alerts[item["id"]] = item
        return deepcopy(item)


store = InMemoryStore()
