"""Local fixtures for agent development. Not a PostgreSQL substitute for production."""
from copy import deepcopy
import json
from pathlib import Path
from datetime import datetime,timedelta,timezone

from app.core.store import InMemoryStore, now_iso, new_id
from app.core.repository import RepositoryError


class DemoRepository:
    mode = "demo"

    def __init__(self,path: Path | None = None):
        self.store = InMemoryStore()
        self.path = path
        # Relative dates keep newly created local fixtures usable after the original mock dates.
        today = datetime.now(timezone(timedelta(hours=9))).date()
        for offset,festival in enumerate(self.store.festivals.values()):
            start = today+timedelta(days=1+offset*7)
            festival["startDate"] = start.isoformat()
            festival["endDate"] = (start+timedelta(days=1)).isoformat()
            for index,row in enumerate(festival["operatingHours"]): row["date"]=(start+timedelta(days=index)).isoformat()
        if path and path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            for name in ("users","festivals","groups","alerts","matching_runs","jobs"):
                setattr(self.store,name,data[name])

    def persist(self):
        if self.path:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            temp = self.path.with_suffix(".tmp")
            temp.write_text(json.dumps({name:getattr(self.store,name) for name in ("users","festivals","groups","alerts","matching_runs","jobs")},ensure_ascii=False),encoding="utf-8")
            temp.replace(self.path)

    async def user(self,user_id): return self.store.user(user_id)
    async def users(self,exclude_id=None): return [deepcopy(u) for u in self.store.users.values() if u["id"] != exclude_id]
    async def update_profile(self,user_id,values):
        with self.store.lock:
            self.store.users[user_id]["profile"].update(values)
            self.persist()
            return self.store.user(user_id)
    async def onboarding_completed(self,user_id):
        user = self.store.users.get(user_id)
        return bool(user and user.get("onboardingCompletedAt"))
    async def complete_onboarding(self,user_id):
        with self.store.lock:
            self.store.users[user_id].setdefault("onboardingCompletedAt", now_iso())
            self.persist()
            return True
    async def update_consents(self,user_id,values):
        with self.store.lock:
            self.store.users[user_id]["notificationConsent"].update(values)
            self.persist()
            return deepcopy(self.store.users[user_id]["notificationConsent"])
    async def festival(self,festival_id): return self.store.festival(festival_id)
    async def festivals(self,**filters):
        rows = self.store.festivals_view()
        for name in ("region","category"):
            if filters.get(name): rows = [r for r in rows if r[name] == filters[name]]
        if filters.get("keyword"): rows = [r for r in rows if filters["keyword"] in r["name"]]
        if filters.get("year"): rows = [r for r in rows if int(r["startDate"][:4]) == filters["year"]]
        if filters.get("month"): rows = [r for r in rows if int(r["startDate"][5:7]) == filters["month"]]
        if filters.get("start_date"): rows = [r for r in rows if r["endDate"] >= str(filters["start_date"])]
        if filters.get("end_date"): rows = [r for r in rows if r["startDate"] <= str(filters["end_date"])]
        if filters.get("status") == "past": rows = [r for r in rows if r["status"] == "past"]
        if filters.get("status") == "available": rows = [r for r in rows if r["status"] != "past" and r["riskStatus"] != "cancelled"]
        return rows
    async def upsert_festival(self,item):
        result = self.store.add_festival(item); self.persist(); return result
    async def group(self,group_id,**kwargs): return self.store.group(group_id)
    async def list_groups(self, *, festival_id, status, keyword, offset, limit):
        groups = [
            group for group in self.store.groups.values()
            if (not festival_id or group["festivalId"] == festival_id)
            and (not status or group["status"] == status)
            and (not keyword or keyword in group["title"])
        ]
        groups.sort(key=lambda group: (group["createdAt"], group["id"]), reverse=True)
        return deepcopy(groups[offset : offset + limit]), len(groups)
    async def create_group(self,user_id,payload):
        if not await self.festival(payload["festivalId"]): raise RepositoryError("FESTIVAL_NOT_FOUND","축제를 찾을 수 없습니다.",404)
        if payload.get("workflowGroupId") and payload["workflowGroupId"] in self.store.groups:
            return deepcopy(self.owned(payload["workflowGroupId"], user_id))
        self.store.create_group(user_id,payload)
        group = list(self.store.groups.values())[-1]
        if payload.get("workflowGroupId"):
            del self.store.groups[group["id"]]
            group["id"] = payload["workflowGroupId"]
            self.store.groups[group["id"]] = group
        conditions = payload.get("conditions", {})
        if conditions.get("date"):
            group["schedule"]["current"]["date"] = conditions["date"]
        if conditions.get("start_time"):
            group["schedule"]["current"]["time"] = conditions["start_time"]
        current = group["schedule"]["current"]
        current["endTime"] = conditions.get("end_time") or (datetime.fromisoformat(f"{current['date']}T{current['time']}") + timedelta(minutes=90)).strftime("%H:%M")
        group["schedule"]["items"] = [deepcopy(group["schedule"]["current"])]
        self.persist(); return deepcopy(group)
    def owned(self,group_id,user_id):
        group = self.store.groups.get(group_id)
        if not group: raise RepositoryError("GROUP_NOT_FOUND","모임을 찾을 수 없습니다.",404)
        if group["leaderId"] != user_id: raise RepositoryError("LEADER_ONLY","모임장만 수행할 수 있습니다.",403)
        return group
    def version(self,group,version):
        if group["version"] != version: raise RepositoryError("RESOURCE_VERSION_CONFLICT","모임 버전이 변경되었습니다.",409)
    async def update_group(self,group_id,values,version,leader_id=None):
        with self.store.lock:
            group = self.store.groups[group_id]
            if leader_id is not None and group["leaderId"] != leader_id:
                raise RepositoryError("LEADER_ONLY","모임장만 수행할 수 있습니다.",403)
            if group["version"] != version: return None
            group.update(values); group["version"] += 1
            self.store.update_status(group); self.persist(); return deepcopy(group)
    async def active_chat_member_ids(self, group_id):
        group = self.store.groups.get(group_id)
        return {member["userId"] for member in group["members"]} if group else set()

    async def messages(self, group_id, *, before=None, after=None, limit=50):
        rows = deepcopy(self.store.groups[group_id]["messages"])
        rows.sort(key=lambda row: (row["createdAt"], row["id"]))
        positions = {row["id"]: index for index, row in enumerate(rows)}
        if (before and before not in positions) or (after and after not in positions):
            return []
        start = positions[after] + 1 if after else 0
        stop = positions[before] if before else len(rows)
        rows = rows[start:stop]
        return rows[:limit] if after is not None else rows[-limit:]
    async def add_message(self,group_id,user_id,text,client_message_id=None):
        group = self.store.groups[group_id]
        existing = next((r for r in group["messages"] if client_message_id and r.get("clientMessageId") == client_message_id and r["sender"]["id"] == user_id),None)
        if existing: return deepcopy(existing)
        item = self.store.add_message(group,user_id,text); group["messages"][-1]["clientMessageId"] = client_message_id
        self.persist(); return item
    async def schedule(self,group_id):
        group = await self.group(group_id); return group["schedule"] if group else None
    async def save_agent_proposal(self,group_id,user_id,proposal_id,plan,group_version,schedule_version):
        with self.store.lock:
            group = self.owned(group_id,user_id); self.version(group,group_version)
            schedule = group["schedule"]
            if schedule["version"] != schedule_version: raise RepositoryError("RESOURCE_VERSION_CONFLICT","일정 버전이 변경되었습니다.",409)
            existing = next((p for p in schedule["proposals"] if p["id"] == proposal_id),None)
            if existing: return deepcopy(existing)
            proposal = {"id":proposal_id,"groupId":group_id,"items":deepcopy(plan["items"]),"summary":plan["summary"],"schedule":deepcopy(plan["items"][0]),"status":"draft","version":schedule_version,"createdAt":now_iso()}
            if plan.get("targetFestivalId"):
                proposal["targetFestivalId"] = plan["targetFestivalId"]
            schedule["proposals"].append(proposal); self.persist(); return deepcopy(proposal)
    async def reject_agent_proposal(self,group_id,proposal_id,user_id):
        with self.store.lock:
            group = self.owned(group_id,user_id)
            for proposal in group["schedule"]["proposals"]:
                if proposal["id"] == proposal_id and proposal["status"] == "draft": proposal["status"] = "rejected"
            self.persist()
    async def commit_agent_proposal(self,group_id,proposal_id,user_id,group_version,schedule_version,availability):
        with self.store.lock:
            group = self.owned(group_id,user_id); schedule = group["schedule"]
            proposal = next((p for p in schedule["proposals"] if p["id"] == proposal_id),None)
            if not proposal: raise RepositoryError("PROPOSAL_NOT_FOUND","제안을 찾을 수 없습니다.",404)
            if proposal["status"] == "approved": return deepcopy(schedule)
            self.version(group,group_version)
            current = [{"userId":m["userId"],"availableFrom":self.store.users[m["userId"]]["profile"].get("availableFrom"),"availableUntil":self.store.users[m["userId"]]["profile"].get("availableUntil")} for m in group["members"]]
            if schedule["version"] != schedule_version or current != availability or proposal["status"] != "draft" or proposal["version"] != schedule_version:
                raise RepositoryError("RESOURCE_VERSION_CONFLICT","참여 조건 또는 일정이 변경되었습니다.",409)
            proposal["status"] = "approved"
            if proposal.get("targetFestivalId"):
                group["festivalId"] = proposal["targetFestivalId"]
            schedule.update(items=deepcopy(proposal["items"]),current=deepcopy(proposal["items"][0]),version=schedule_version+1,validation={"status":"valid","conflict":None})
            group["version"] += 1
            self.store.add_message(group,None,"모임장이 검증된 새 일정을 승인했습니다.","system")
            self.persist(); return deepcopy(schedule)

    def __getattr__(self,name):
        # Existing database endpoints remain available with DATABASE_URL. Do not fake unsupported writes.
        async def unavailable(*args,**kwargs):
            raise RepositoryError("DEMO_OPERATION_UNAVAILABLE",f"{name} 작업은 DB 연결이 필요합니다.",503)
        return unavailable
