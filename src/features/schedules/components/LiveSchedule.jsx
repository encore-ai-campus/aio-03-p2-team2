// 공동 일정 — 실제 API 버전 (플로우: 참여 승인 → 일정 초안 → 검증·자가 수정 → 모임장 승인 → 확정)
// 화면 구조·클래스는 기존 데모 일정 화면(SchedulePage)과 같게 유지한다.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { getGroup, listGroups } from "../../groups/api/groupsApi.js";
import { decideSchedule, draftSchedule, getSchedule } from "../api/scheduleApi.js";

const ERROR_TEXT = {
  LEADER_ONLY: "모임장만 일정을 만들 수 있어요.",
  CHECKPOINT_STALE: "일정 상태가 바뀌었어요. 초안을 다시 만들어 주세요.",
  RUN_NOT_WAITING: "이미 처리된 초안이에요.",
  GROUP_MEMBER_ONLY: "모임 참여자만 일정을 볼 수 있어요.",
};
const msg = (e) => ERROR_TEXT[e.code] || e.message || "요청에 실패했어요.";
const REPAIR_KO = { regenerate: "조건을 반영해 다시 생성", refresh_tools: "최신 정보로 다시 조회", ask_user: "사용자에게 추가 확인", stop: "중단" };

// 일정 항목 목록 → 기존 타임라인 모양
function Timeline({ items }) {
  if (!items?.length) return <div className="empty">일정이 없어요.</div>;
  return (
    <div className="timeline">
      {items.map((x, i) => (
        <div className="timeline-row" key={i}>
          <span className="time">
            {x.time}
            {x.endTime ? `~${x.endTime}` : ""}
          </span>
          <strong>{x.label}</strong>
          <p>
            {x.date ? `${x.date} · ` : ""}
            {x.description || x.desc || ""}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function LiveSchedule({ festivals, pill, onFail }) {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [groups, setGroups] = useState(null);
  const [group, setGroup] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [run, setRun] = useState(null); // 일정 초안 에이전트 실행 결과
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const groupId = params.get("groupId") || groups?.[0]?.id;
  const festival = (id) => festivals.find((f) => f.id === id);

  useEffect(() => {
    listGroups()
      .then(setGroups)
      .catch((e) => {
        console.warn("[schedule] 모임 목록 실패 → 데모", e);
        onFail?.();
      });
  }, [onFail]);

  const load = useCallback(async () => {
    if (!groupId) return;
    setGroup(null);
    setSchedule(null);
    try {
      const g = await getGroup(groupId);
      setGroup(g);
      if (me && g.members.some((m) => m.userId === me.id)) setSchedule(await getSchedule(groupId));
    } catch (e) {
      setNotice(msg(e));
    }
  }, [groupId, me]);
  useEffect(() => {
    setRun(null);
    setNotice("");
    load();
  }, [load]);

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
      setNotice(msg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!groups) return <div className="empty">모임 불러오는 중…</div>;
  const isLeader = group && me && group.leaderId === me.id;
  const isMember = group && me && group.members.some((m) => m.userId === me.id);
  const attempts = run?.candidateHistory || [];
  const repaired = attempts.length > 1;

  return (
    <div className="columns schedule-columns">
      <section className="box pad">
        <div className="section-head" style={{ marginTop: 0 }}>
          <h2>공동 일정 타임라인</h2>
          {group && pill(group.status === "open" ? "모집 중" : "모집 마감", group.status === "open" ? "green" : "dark")}
        </div>
        <div className="field">
          <label htmlFor="live-schedule-group">모임 선택</label>
          <select id="live-schedule-group" value={groupId || ""} onChange={(e) => setParams({ groupId: e.target.value })}>
            {groups.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
                {me && x.leaderId === me.id ? " (내가 모임장)" : ""}
              </option>
            ))}
          </select>
        </div>

        {!group ? (
          <div className="empty">모임 불러오는 중…</div>
        ) : !isMember ? (
          <div className="note warning">🔒 공동 일정은 모임 참여자에게만 열려요. 동행 커뮤니티에서 참여 신청 후 승인되면 볼 수 있어요.</div>
        ) : (
          <>
            <div className="metadata">
              🎪 {festival(group.festivalId)?.name || group.festivalId} · 👤 {group.memberCount}/{group.capacity}명 참여 확정
            </div>
            <h3 style={{ fontSize: "14px", margin: "12px 0 6px" }}>현재 확정 일정</h3>
            <Timeline items={schedule?.items} />

            {notice && (
              <div className="note coral" role="status" style={{ marginTop: "10px" }}>
                {notice}
              </div>
            )}

            {/* 에이전트 초안 (승인 전에는 확정되지 않음) */}
            {run && run.status === "waiting_approval" && (
              <div className="alt-card" style={{ marginTop: "12px" }}>
                <strong>✨ AI 일정 초안 · 검증 통과</strong>
                <p className="sm muted" style={{ margin: "8px 0" }}>
                  {run.candidate?.summary || "참여자 가능 시간과 운영시간을 반영한 일정"} · <b>모임장 승인 전에는 확정되지 않아요.</b>
                </p>
                <Timeline items={run.candidate?.items} />
                {isLeader && (
                  <div className="btnrow" style={{ marginTop: "10px" }}>
                    <button type="button" className="btn primary" disabled={busy} onClick={() => act(() => decideSchedule(run, "approve")).then(load)}>
                      이 일정으로 확정하기
                    </button>
                    <button type="button" className="btn" disabled={busy} onClick={() => act(() => decideSchedule(run, "reject"), () => "초안을 거절했어요. 기존 일정은 그대로예요.")}>
                      거절
                    </button>
                  </div>
                )}
              </div>
            )}
            {run && run.status === "completed" && <div className="note good" style={{ marginTop: "12px" }}>✅ 일정을 확정했어요! 참여자에게 공유돼요.</div>}
            {run && ["failed", "waiting_input", "rejected", "cancelled"].includes(run.status) && (
              <div className="note warning" style={{ marginTop: "12px" }}>
                <strong>초안을 확정하지 못했어요</strong>
                <br />
                {run.errors?.[0]?.message || run.interrupt?.message || run.result?.summary || run.status}
              </div>
            )}

            <div className="btnrow" style={{ marginTop: "15px" }}>
              {isLeader ? (
                // 초안 승인 대기 중에는 확정/거절만 보이도록 다시 만들기 버튼을 숨긴다
                run?.status === "waiting_approval" ? null : (
                <button type="button" className="btn primary" disabled={busy} onClick={() => act(() => draftSchedule(group.id))}>
                  {busy ? "AI가 일정을 만드는 중…" : run ? "AI 일정 초안 다시 만들기" : "AI 일정 초안 만들기"}
                </button>
                )
              ) : (
                pill("모임장이 일정을 확정해요", "purple")
              )}
            </div>
          </>
        )}
      </section>

      <section>
        <div className="note good">
          <strong>확정은 모임장만</strong> · AI는 참여자 모두가 가능한 일정을 만들고 스스로 검증해요. 검증에 실패하면 원인을 분석해 고친 뒤 다시 검증해요.
        </div>

        {/* 자가 수정 전후 비교 (MVP⑥) */}
        {run && (
          <div className="box pad" style={{ marginTop: "15px" }}>
            <div className="section-head" style={{ marginTop: 0 }}>
              <h2>🔁 AI 검증·자가 수정 기록</h2>
              {pill(repaired ? `자가 수정 ${attempts.length - 1}회` : "첫 초안 검증 통과", repaired ? "purple" : "green")}
            </div>
            {attempts.map((a, i) => (
              <div className="request" key={i} style={{ alignItems: "flex-start" }}>
                <div>
                  <strong>
                    {i + 1}차 초안 {a.errors?.length ? "❌ 검증 실패" : "✅ 검증 통과"}
                  </strong>
                  <br />
                  <small>
                    {a.repair?.action ? `수정 전략: ${REPAIR_KO[a.repair.action] || a.repair.action}${a.repair.reason ? ` — ${a.repair.reason}` : ""}` : "처음 생성한 초안"}
                  </small>
                  {a.errors?.map((e, j) => (
                    <div className="tiny" key={j}>
                      ⚠️ {e.message}
                    </div>
                  ))}
                  {a.candidate?.items?.length > 0 && (
                    <div className="tiny muted">
                      {a.candidate.items.map((x) => `${x.time} ${x.label}`).join(" → ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {run.comparison?.before && (
              <details style={{ marginTop: "10px" }}>
                <summary className="sm">기존 일정과 비교</summary>
                <div className="tiny muted" style={{ marginTop: "6px" }}>기존</div>
                <Timeline items={run.comparison.before.items} />
                <div className="tiny muted" style={{ marginTop: "6px" }}>새 초안</div>
                <Timeline items={run.comparison.after?.items} />
              </details>
            )}
            <details style={{ marginTop: "10px" }}>
              <summary className="sm muted">🔧 에이전트 실행 과정 · 단계 {run.trace?.length || 0}개</summary>
              <pre className="tiny" style={{ whiteSpace: "pre-wrap" }}>
                {(run.trace || []).map((t, i) => `${i + 1}. ${t.node}${t.tools?.length ? ` → ${t.tools.join(", ")}` : ""}${t.errorCodes?.length ? ` ⚠️ ${t.errorCodes.join(", ")}` : ""}`).join("\n")}
              </pre>
            </details>
          </div>
        )}
      </section>
    </div>
  );
}
