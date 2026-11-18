// 공동 일정 — 실제 API 버전 (플로우: 참여 승인 → 일정 초안 → 검증·자가 수정 → 모임장 승인 → 확정)
// v3 화면: 모임 카드 → 한 장 카드(왼쪽 확정 일정·AI 초안 | 오른쪽 검증·자가 수정 기록·기존/새 비교)
// 상태·API는 hooks/useSelectedSchedule.js, 화면 조각은 ScheduleHead·ScheduleGroupCard·ScheduleDraftPanel·ScheduleVerifyPanel
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { listGroups } from "../../groups/api/groupsApi.js";
import { useSelectedSchedule } from "../hooks/useSelectedSchedule.js";
import { keysOf } from "../lib/scheduleFormat.js";
import ScheduleDraftPanel from "./ScheduleDraftPanel.jsx";
import ScheduleGroupCard from "./ScheduleGroupCard.jsx";
import ScheduleHead from "./ScheduleHead.jsx";
import ScheduleVerifyPanel from "./ScheduleVerifyPanel.jsx";

export default function LiveSchedule({ festivals, onFail }) {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [groups, setGroups] = useState(null);
  const groupId = params.get("groupId") || groups?.[0]?.id;

  useEffect(() => {
    listGroups()
      .then(setGroups)
      .catch((e) => {
        console.warn("[schedule] 모임 목록 실패", e);
        onFail?.();
      });
  }, [onFail]);

  return (
    <SelectedSchedule
      key={groupId}
      groupId={groupId}
      groups={groups}
      festivals={festivals}
      me={me}
      onGroupChange={(id) => setParams({ groupId: id })}
    />
  );
}

function SelectedSchedule({ groupId, groups, festivals, me, onGroupChange }) {
  const navigate = useNavigate();
  const { group, schedule, run, busy, notice, approve, reject, draft } = useSelectedSchedule(groupId, me?.id);
  const festival = (id) => festivals.find((f) => f.id === id);

  if (!groups)
    return (
      <>
        <ScheduleHead done={0} />
        <div className="empty">모임 불러오는 중…</div>
      </>
    );
  if (!groups.length)
    return (
      <>
        <ScheduleHead done={0} />
        <div className="sc-lock">
          <i className="ti ti-calendar-off" aria-hidden="true" />
          <b>아직 참여한 모임이 없어요</b>
          <span>동행 커뮤니티에서 모임에 참여하면 공동 일정을 볼 수 있어요.</span>
          <button type="button" className="btn primary" onClick={() => navigate("/groups")}>
            동행 커뮤니티로 가기 →
          </button>
        </div>
      </>
    );

  const isLeader = group && me && group.leaderId === me.id;
  const isMember = group && me && group.members.some((m) => m.userId === me.id);
  const f = group ? festival(group.festivalId) : null;

  // 진행 단계: 참여 확정 → 초안 → 검증 통과(승인 대기) → 확정
  const doneCount = !isMember ? 0 : run?.status === "completed" ? 4 : run?.status === "waiting_approval" ? 3 : run ? 2 : 1;

  const before = run?.comparison?.before?.items;
  const after = run?.comparison?.after?.items || run?.candidate?.items;
  const beforeKeys = keysOf(before);

  return (
    <>
      <ScheduleHead done={doneCount} />

      <ScheduleGroupCard group={group} f={f} me={me} isMember={isMember} groupId={groupId} groups={groups} onGroupChange={onGroupChange} />

      {!group ? null : !isMember ? (
        <div className="sc-lock">
          <i className="ti ti-lock" aria-hidden="true" />
          <b>참여가 확정된 사람만 볼 수 있어요</b>
          <span>동행 커뮤니티에서 참여를 신청하고, 모임장 승인을 받으면 공동 일정이 열려요.</span>
          <button type="button" className="btn primary" onClick={() => navigate(`/groups?groupId=${encodeURIComponent(group.id)}`)}>
            커뮤니티에서 참여 신청하기 →
          </button>
        </div>
      ) : (
        <div className="sc-card">
          <ScheduleDraftPanel
            schedule={schedule}
            run={run}
            notice={notice}
            busy={busy}
            isLeader={isLeader}
            beforeKeys={beforeKeys}
            onApprove={approve}
            onReject={reject}
            onDraft={draft}
          />
          <ScheduleVerifyPanel run={run} before={before} after={after} beforeKeys={beforeKeys} />
        </div>
      )}
    </>
  );
}
