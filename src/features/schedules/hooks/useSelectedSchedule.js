// 선택한 모임의 공동 일정 상태·API — 모임 상세·확정 일정 조회, 초안 만들기·확정·거절
import { useEffect, useState } from "react";
import { getGroup } from "../../groups/api/groupsApi.js";
import { decideSchedule, draftSchedule, getSchedule } from "../api/scheduleApi.js";
import { scheduleError } from "../lib/scheduleFormat.js";

export function useSelectedSchedule(groupId, meId) {
  const [group, setGroup] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [run, setRun] = useState(null); // 일정 초안 에이전트 실행 결과
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!groupId) return;
    let alive = true;
    getGroup(groupId)
      .then(async (g) => {
        if (!alive) return;
        setGroup(g);
        const nextSchedule = g.members.some((m) => m.userId === meId) ? await getSchedule(groupId) : null;
        if (alive) setSchedule(nextSchedule);
      })
      .catch((e) => {
        if (alive) setNotice(scheduleError(e));
      });
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
  const reject = () => act(() => decideSchedule(run, "reject"), () => "초안을 거절했어요. 기존 일정은 그대로예요.");
  const draft = () => act(() => draftSchedule(group.id));

  return { group, schedule, run, busy, notice, approve, reject, draft };
}
