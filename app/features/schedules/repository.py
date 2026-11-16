"""Persistence only. Planning and validation belong to features.agents."""
import json

from app.core.repository import RepositoryBase, RepositoryError, _hhmm, assert_rpc_success


class ScheduleRepositoryMixin(RepositoryBase):
    async def schedule(self,group_id):
        group = await self.group(group_id)
        return group["schedule"] if group else None

    async def _lock_agent_resources(self,connection,group_id,user_id):
        group = await connection.fetchrow("select * from groups where id=$1 for update",group_id)
        if not group: raise RepositoryError("GROUP_NOT_FOUND","모임을 찾을 수 없습니다.",404)
        if group["leader_id"] != user_id: raise RepositoryError("LEADER_ONLY","모임장만 수행할 수 있습니다.",403)
        schedule = await connection.fetchrow("select * from group_schedules where group_id=$1 for update",group_id)
        if not schedule: raise RepositoryError("SCHEDULE_MISSING","일정을 찾을 수 없습니다.",409)
        return group,schedule

    @staticmethod
    def _agent_versions(group,schedule,group_version,schedule_version):
        if group["version"] != group_version or schedule["version"] != schedule_version:
            raise RepositoryError("RESOURCE_VERSION_CONFLICT","모임 또는 일정이 변경되어 새 승인이 필요합니다.",409)

    async def save_agent_proposal(self,group_id,user_id,proposal_id,plan,group_version,schedule_version):
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                group,schedule = await self._lock_agent_resources(connection,group_id,user_id)
                self._agent_versions(group,schedule,group_version,schedule_version)
                pending = await connection.fetchrow("select id from schedule_proposals where group_id=$1 and status='draft'",group_id)
                if pending and pending["id"] != proposal_id:
                    raise RepositoryError("PROPOSAL_ALREADY_PENDING","기존 일정 제안을 승인 또는 거절한 뒤 새 실행을 시작해 주세요.",409)
                await connection.execute("insert into schedule_proposals (id,group_id,base_version,items,strategy,status,created_by) values ($1,$2,$3,$4::jsonb,'agent_validated','draft',$5) on conflict (id) do nothing",proposal_id,group_id,schedule_version,json.dumps(plan["items"],ensure_ascii=False),user_id)
        return {"id":proposal_id,"groupId":group_id,"status":"draft","items":plan["items"],"version":schedule_version}

    async def reject_agent_proposal(self,group_id,proposal_id,user_id):
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                await self._lock_agent_resources(connection,group_id,user_id)
                await connection.execute("update schedule_proposals set status='rejected',decided_by=$1,decided_at=now() where id=$2 and group_id=$3 and status='draft'",user_id,proposal_id,group_id)

    async def commit_agent_proposal(self,group_id,proposal_id,user_id,group_version,schedule_version,availability):
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                result = await connection.fetchval(
                    "select public.rpc_approve_schedule_proposal($1,$2,$3,$4,$5,$6::jsonb)",
                    group_id,
                    proposal_id,
                    user_id,
                    group_version,
                    schedule_version,
                    json.dumps(availability, ensure_ascii=False),
                )
                assert_rpc_success(result)
        return await self.schedule(group_id)

        # Kept below for reference while old deployments are migrated to the RPC.
        if False:
                group,schedule = await self._lock_agent_resources(connection,group_id,user_id)
                proposal = await connection.fetchrow("select * from schedule_proposals where id=$1 and group_id=$2 for update",proposal_id,group_id)
                if not proposal: raise RepositoryError("PROPOSAL_NOT_FOUND","일정 제안을 찾을 수 없습니다.",404)
                if proposal["status"] == "approved":
                    # A checkpoint retry after a committed transaction must not apply it twice.
                    return self._schedule_view(schedule,[proposal])
                self._agent_versions(group,schedule,group_version,schedule_version)
                if proposal["status"] != "draft" or proposal["base_version"] != schedule_version:
                    raise RepositoryError("RESOURCE_VERSION_CONFLICT","제안이 만료되었습니다.",409)
                rows = await connection.fetch("select gm.user_id,p.available_from from group_members gm join user_profiles p on p.user_id=gm.user_id where gm.group_id=$1 and gm.left_at is null order by gm.user_id for share of gm,p",group_id)
                current = [{"userId":r["user_id"],"availableFrom":_hhmm(r["available_from"]),"availableUntil":None} for r in rows]
                if current != sorted(availability,key=lambda r:r["userId"]):
                    raise RepositoryError("RESOURCE_VERSION_CONFLICT","참여자 가능 시간이 변경되었습니다.",409)
                items = json.loads(proposal["items"]) if isinstance(proposal["items"],str) else proposal["items"]
                await connection.execute("update schedule_proposals set status='approved',decided_by=$1,decided_at=now() where id=$2",user_id,proposal_id)
                await connection.execute("update group_schedules set items=$1::jsonb,version=version+1,validation_status='valid',conflict=null,updated_by=$2,updated_at=now() where group_id=$3",json.dumps(items,ensure_ascii=False),user_id,group_id)
                await connection.execute("update groups set version=version+1,updated_at=now() where id=$1",group_id)
                await connection.execute("insert into group_messages (group_id,type,text,system_event) values ($1,'system',$2,'schedule_changed')",group_id,"모임장이 검증된 새 일정을 승인했습니다.")
        return await self.schedule(group_id)
