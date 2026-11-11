import { Fragment } from "react";
import { useDemo } from "../../../app/DemoProvider.jsx";
export default function SchedulePage() {
  const demo = useDemo();
  const {
    state,
    btn,
    pill,
    fieldProps,
    festival,
    group,
    groupClosed,
    pageHead,
    timeline,
  } = demo;
  const myRooms = state.groups.filter((g) => g.members.includes(state.actor)),
    g = group(state.selectedGroup) || myRooms[0],
    member = g?.members.includes(state.actor),
    leader = g && g.leader === state.actor;
  return (
    <>
      {pageHead(
        "LANGGRAPH · VALIDATION LOOP",
        "🗓️ 공동 일정 검증·조정",
        "새 멤버 승인 → 정원 확인 → 시간 충돌 → AI 대안 생성·자가 검증 → 모임장 승인 → 채팅 공지",
      )}

      <div className="columns schedule-columns">
        <section className="box pad">
          <div
            className="section-head"
            style={{
              marginTop: "0",
            }}
          >
            <h2>📍 공동 일정 타임라인</h2>
            {pill(
              g && groupClosed(g) ? "모집 마감" : "모집 중",
              g && groupClosed(g) ? "dark" : "green",
            )}
          </div>

          <div className="field">
            <label>모임 선택</label>
            <select id="schedule-group" {...fieldProps("schedule-group")}>
              {state.groups.map((x, index) => (
                <Fragment key={index}>
                  <option value={x.id}>{x.title}</option>
                </Fragment>
              ))}
            </select>
          </div>

          {!g ? (
            <>
              <div className="empty">모임이 없습니다.</div>
            </>
          ) : !member ? (
            <>
              <div className="note warning">
                🔒 공동 일정은 모임 참여자에게만 열립니다. 해당 모임에 참여하면
                일정 변경을 확인할 수 있습니다.
              </div>
              {btn("모임 게시글로 이동", `openGroup:${g.id}`, "btn")}
            </>
          ) : (
            <>
              <div className="metadata">
                {"🎪 "}
                {festival(g.festivalId).name}
                {" · 👤 "}
                {g.members.length}/{g.max}
                {"명 승인 · ⏳ "}
                {g.pending.length}명 신청 대기
              </div>
              {timeline(g.schedule)}
              {g.conflict ? (
                <>
                  <div className="note warning">
                    <strong>⚠️ 일정 충돌 발견</strong>
                    <br />
                    {g.conflict.reason}
                  </div>
                </>
              ) : (
                pill("✅ 현재 참여자 기준 일정 충돌 없음", "green")
              )}

              {g.conflict && g.proposal ? (
                <>
                  <div className="alt-card">
                    <strong>✨ AI 수정 제안 · 검증 완료</strong>
                    <p
                      className="sm muted"
                      style={{
                        margin: "8px 0",
                      }}
                    >
                      {
                        "모든 승인된 참여자가 가능한 시작 시각으로 조정합니다. 아래 제안은 "
                      }
                      <b>모임장 승인 전에는 확정되지 않습니다.</b>
                    </p>
                    {timeline(g.proposal)}
                    {leader
                      ? btn(
                          "✓ 모임장 승인 → 일정 반영·채팅 공지",
                          `acceptSchedule:${g.id}`,
                          "btn primary block",
                        )
                      : pill("모임장 최종 승인 대기", "purple")}
                  </div>
                </>
              ) : (
                ""
              )}

              <div
                className="btnrow"
                style={{
                  marginTop: "15px",
                }}
              >
                {g.conflict && !g.proposal
                  ? leader
                    ? btn(
                        "✨ AI 대안 일정 생성·재검증",
                        `propose:${g.id}`,
                        "btn primary",
                      )
                    : pill("모임장이 대안을 생성할 예정", "purple")
                  : ""}
                {leader && g.pending.length
                  ? btn(
                      "대기 인원 승인 페이지",
                      `openGroup:${g.id}`,
                      "btn soft",
                    )
                  : ""}
                {btn("💬 채팅 알림 확인", `openChat:${g.id}`, "btn")}
              </div>
            </>
          )}
        </section>

        <section>
          <div className="box pad">
            <div
              className="section-head"
              style={{
                margin: "0 0 12px",
              }}
            >
              <h2>🧠 에이전트 처리 로그</h2>
              {pill("LangGraph 시뮬레이션", "purple")}
            </div>
            <div className="logs">
              {g?.logs?.length ? (
                g.logs.map((l, i) => (
                  <Fragment key={i}>
                    <div>
                      <time>{l.at || "--:--"}</time>
                      <span className="node">
                        {String(i + 1).padStart(2, "0")}
                      </span>{" "}
                      <span
                        className={
                          l.kind === "warn"
                            ? "warn"
                            : l.kind === "done"
                              ? "done"
                              : ""
                        }
                      >
                        {l.text}
                      </span>
                    </div>
                  </Fragment>
                ))
              ) : (
                <>
                  <div>아직 검증 이벤트가 없습니다.</div>
                </>
              )}
            </div>
            <p
              className="source-note"
              style={{
                marginTop: "11px",
              }}
            >
              실제 LangGraph 모델 및 실시간 API와 연결된 것이 아닌, 같은 처리
              흐름을 재현한 규칙 기반 데모입니다.
            </p>
          </div>
          <div
            className="box pad"
            style={{
              marginTop: "15px",
            }}
          >
            <h3>🎬 일정 충돌 시연</h3>
            <p className="sm muted">
              {"모임장 계정에서 "}
              <b>부산 음악축제</b>
              {"의 "}
              <b>하늘(15:00 이후 참석 가능)</b>을 승인하면 기존 13:00 만남과
              충돌합니다.
            </p>
            <div className="btnrow">
              {btn("시연 모임으로 이동", "demoConflict", "btn soft")}
              {btn("시연 일정 초기화", "resetConflict", "btn")}
            </div>
          </div>
          <div
            className="note"
            style={{
              marginTop: "15px",
            }}
          >
            <strong>통제 원칙</strong>
            {
              " · AI는 대안을 제시하고 검증할 뿐 확정 권한이 없습니다. 최종 일정 변경은 모임장만 승인할 수 있습니다."
            }
          </div>
        </section>
      </div>
    </>
  );
}
