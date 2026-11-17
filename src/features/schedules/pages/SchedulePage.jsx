import { Fragment, useCallback, useState } from "react";
import { useDemo } from "../../../app/DemoProvider.jsx";
import { useFestivals } from "../../festivals/hooks/useFestivals.js";
import LiveSchedule from "../components/LiveSchedule.jsx";
import { DEMO_MODE } from "../../../shared/lib/demoMode.js";
import { ApiError } from "../../../shared/components/ApiState.jsx";

// v4.3 · 처리 기록을 사용자가 읽기 쉬운 말로 바꿔 보여준다
const NODE_KO = {
  validate_capacity: "정원 확인",
  availability_fetch: "참여 가능 시간 확인",
  validate_timeline: "일정 검증",
  reflection: "재검토",
  propose_alternative: "조정안 생성",
  self_validate: "조정안 재검증",
  human_approval: "모임장 확인 대기",
  host_approval: "모임장 승인",
  commit_timeline: "일정 반영",
  send_message: "채팅방 공지",
  create_room: "모임방 생성",
  verify_proposal: "조정안 검증",
};
const friendlyLog = (t) => {
  const m = String(t).match(/^NODE (\w+) · (.*)$/);
  return m ? `${NODE_KO[m[1]] || m[1]} — ${m[2]}` : String(t).replace(/^NODE \w+ · /, "");
};

export default function SchedulePage() {
  const demo = useDemo();
  const { state, btn, pill, fieldProps, festival, group, groupClosed, pageHead, timeline } = demo;
  const myRooms = state.groups.filter((g) => g.members.includes(state.actor)),
    g = group(state.selectedGroup) || myRooms[0],
    member = g?.members.includes(state.actor),
    leader = g && g.leader === state.actor;
  const logs = g?.logs || [];
  // 실제 API 우선 (실패 시 아래 기존 데모 화면)
  const { festivals } = useFestivals(state.festivals);
  const [apiFailed, setApiFailed] = useState(false);
  const [apiError, setApiError] = useState(false);
  // 데모 모드일 때만 예시 화면으로, 아니면 「서버에 연결할 수 없어요」
  const onFail = useCallback(() => (DEMO_MODE ? setApiFailed(true) : setApiError(true)), []);
  return (
    <>
      {/* 실서버 모드: 머리글·진행 단계는 LiveSchedule 안에서 그린다 */}
      {apiError ? (
        <ApiError />
      ) : !apiFailed ? (
        <LiveSchedule festivals={festivals} onFail={onFail} />
      ) : (
      <>
      {pageHead(
        "SCHEDULE CHECK",
        "🗓️ 공동 일정 확인·조정",
        "새 멤버가 들어오면 모두가 가능한 시간인지 자동으로 확인해요. 충돌이 있으면 AI가 조정안을 제안하고, 확정은 모임장이 해요.",
      )}
      <div className="columns schedule-columns">
        <section className="box pad">
          <div className="section-head" style={{ marginTop: "0" }}>
            <h2>공동 일정 타임라인</h2>
            {pill(g && groupClosed(g) ? "모집 마감" : "모집 중", g && groupClosed(g) ? "dark" : "green")}
          </div>
          <div className="field">
            <label htmlFor="schedule-group">모임 선택</label>
            <select id="schedule-group" {...fieldProps("schedule-group")}>
              {state.groups.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
          </div>
          {!g ? (
            <div className="empty">모임이 없어요.</div>
          ) : !member ? (
            <>
              <div className="note warning">
                🔒 공동 일정은 모임 참여자에게만 열려요. 해당 모임에 참여하면 일정 변경을 확인할 수 있어요.
              </div>
              {btn("모임 게시글로 이동", `openGroup:${g.id}`, "btn")}
            </>
          ) : (
            <>
              <div className="metadata">
                🎪 {festival(g.festivalId).name} · 👤 {g.members.length}/{g.max}명 승인 · ⏳ {g.pending.length}명 신청
                대기
              </div>
              {timeline(g.schedule)}
              {g.conflict ? (
                <div className="note warning">
                  <strong>⚠️ 일정 충돌 발견</strong>
                  <br />
                  {g.conflict.reason}
                </div>
              ) : (
                pill("✅ 현재 참여자 기준 일정 충돌 없음", "green")
              )}
              {g.conflict && g.proposal && (
                <div className="alt-card">
                  <strong>✨ AI 수정 제안 · 검증 완료</strong>
                  <p className="sm muted" style={{ margin: "8px 0" }}>
                    모든 승인된 참여자가 가능한 시작 시각으로 조정해요. 아래 제안은{" "}
                    <b>모임장 승인 전에는 확정되지 않아요.</b>
                  </p>
                  {timeline(g.proposal)}
                  {leader
                    ? btn("이 일정으로 확정하기", `acceptSchedule:${g.id}`, "btn primary block")
                    : pill("모임장 최종 승인 대기", "purple")}
                </div>
              )}
              <div className="btnrow" style={{ marginTop: "15px" }}>
                {g.conflict && !g.proposal
                  ? leader
                    ? btn("AI 조정안 받기", `propose:${g.id}`, "btn primary")
                    : pill("모임장이 대안을 생성할 예정", "purple")
                  : ""}
                {leader && g.pending.length ? btn("신청자 승인하러 가기 →", `openGroup:${g.id}`, "btn soft") : ""}
                {btn("채팅방 보기 →", `openChat:${g.id}`, "btn")}
              </div>
            </>
          )}
        </section>
        <section>
          <div className="note good">
            <strong>확정은 모임장만</strong> · AI는 모두가 가능한 조정안을 제안만 해요. 일정이 바뀌면 채팅방에
            자동으로 알려 드려요.
          </div>
          <details className="box pad logbox" style={{ marginTop: "15px" }}>
            <summary>
              <b>AI 처리 과정 보기</b> <span className="muted sm">· {logs.length}단계</span>
            </summary>
            {logs.length ? (
              <>
                <div className="friendly">
                  {logs.map((l, i) => (
                    <div key={i}>
                      <i className={l.kind === "warn" ? "w" : ""}>{l.kind === "warn" ? "!" : "✓"}</i>
                      <span>{friendlyLog(l.text)}</span>
                    </div>
                  ))}
                </div>
                <details style={{ marginTop: "12px" }}>
                  <summary className="sm muted">개발자용 원본 로그</summary>
                  <div className="logs" style={{ marginTop: "8px" }}>
                    {logs.map((l, i) => (
                      <Fragment key={i}>
                        <div>
                          <time>{l.at || "--:--"}</time>
                          <span className="node">{String(i + 1).padStart(2, "0")}</span>{" "}
                          <span className={l.kind === "warn" ? "warn" : l.kind === "done" ? "done" : ""}>
                            {l.text}
                          </span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <p className="source-note" style={{ marginTop: "8px" }}>
                    LangGraph 노드 흐름을 재현한 규칙 기반 데모
                  </p>
                </details>
              </>
            ) : (
              <p className="sm muted" style={{ marginTop: "12px" }}>
                아직 처리 기록이 없어요.
              </p>
            )}
          </details>
        </section>
      </div>
      </>
      )}
    </>
  );
}
