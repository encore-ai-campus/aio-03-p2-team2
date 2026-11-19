// 선택한 모임의 공동 일정 상태·API — 모임 상세·확정 일정 조회, 초안 만들기·확정·거절
import { useEffect, useState } from "react";
import { getGroup } from "../../groups/api/groupsApi.js";
import { decideSchedule, discardScheduleProposal, draftSchedule, getSchedule, getScheduleDraft } from "../api/scheduleApi.js";
import { scheduleError } from "../lib/scheduleFormat.js";

export function useSelectedSchedule(groupId, meId) {
  const [group, setGroup] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [run, setRun] = useState(null); // 일정 초안 에이전트 실행 결과
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unrecoverableDraft, setUnrecoverableDraft] = useState(null);

  useEffect(() => {
    if (!groupId) return;
    let alive = true;
    setLoading(true);
    setUnrecoverableDraft(null);
    getGroup(groupId)
      .then(async (g) => {
        if (!alive) return;
        setGroup(g);
        const nextSchedule = g.members.some((m) => m.userId === meId) ? await getSchedule(groupId) : null;
        if (!alive) return;
        setSchedule(nextSchedule);
        const proposal = g.leaderId === meId && nextSchedule?.proposals?.find((item) => item.status === "draft");
        if (!proposal) return;
        const draft = await getScheduleDraft(groupId);
        if (!alive) return;
        if (draft) setRun(draft);
        else setUnrecoverableDraft(proposal);
      })
      .catch((e) => {
        if (alive) setNotice(scheduleError(e));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [groupId, meId, reload]);

  async function act(fn, done) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await fn();
      if (res && res.runId) setRun(res);
      if (done) setNotice(done(res));
    } catch (e) {
      console.warn("[schedule] 실패", e);
      setNotice(scheduleError(e));
      if (["CHECKPOINT_STALE", "RUN_NOT_WAITING", "RESOURCE_VERSION_CONFLICT", "PROPOSAL_ALREADY_PENDING", "AGENT_RUN_BUSY"].includes(e.code)) {
        setRun(null);
        setReload((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  // 확정하면 확정 일정을 다시 불러온다
  const approve = () =>
    act(async () => {
      const result = await decideSchedule(run, "approve");
      setReload((n) => n + 1);
      return result;
    });
  const reject = () => act(async () => {
    const result = await decideSchedule(run, "reject");
    setReload((n) => n + 1);
    return result;
  }, () => "초안을 거절했어요. 기존 일정은 그대로예요.");
  const discard = () => act(async () => {
    await discardScheduleProposal(group.id, unrecoverableDraft.id, group.version);
    setReload((n) => n + 1);
  }, () => "이전 초안을 폐기했어요.");
  const draft = () => act(() => draftSchedule(group.id));
  const retry = () => {
    setNotice("");
    setReload((n) => n + 1);
  };
  const draftReadFailed = !loading && !run && !unrecoverableDraft &&
    (schedule === null || schedule.proposals?.some((item) => item.status === "draft"));

  return { group, schedule, run, busy, notice, loading, unrecoverableDraft, draftReadFailed, approve, reject, discard, draft, retry };
}
