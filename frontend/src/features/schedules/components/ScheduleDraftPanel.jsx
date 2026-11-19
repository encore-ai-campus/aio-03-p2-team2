// 한 장 카드 왼쪽: 현재 확정 일정 + AI 초안(승인 전에는 확정되지 않음) + 초안 만들기 버튼
import { Timeline } from "./ScheduleTimeline.jsx";

export default function ScheduleDraftPanel({
  schedule, run, notice, busy, loading, unrecoverableDraft, draftReadFailed, isLeader, beforeKeys,
  targetFestivalName, onApprove, onReject, onDiscard, onDraft, onRetry,
}) {
  return (
    <section className="sc-main">
      <h2 className="sc-h">현재 확정 일정</h2>
      <Timeline items={schedule?.items} />

      {notice && (
        <div className="cm-notice" role="status">
          {notice}
        </div>
      )}

      {/* 에이전트 초안 (승인 전에는 확정되지 않음) */}
      {run && run.status === "waiting_approval" && (
        <div className="sc-draft">
          <div className="sc-draft-head">
            <b>{run.targetFestivalId ? `${targetFestivalName || "대체 축제"} 일정 초안` : "AI 일정 초안"}</b>
            <span className="cm-badge open">
              <i className="ti ti-circle-check" aria-hidden="true" /> 검증 통과
            </span>
          </div>
          <p>{run.candidate?.summary || "참여자 가능 시간과 운영시간을 반영한 일정"} · 모임장이 확정하기 전에는 바뀌지 않아요.</p>
          <Timeline items={run.candidate?.items} changedKeys={beforeKeys} />
          {isLeader ? (
            <div className="sc-draft-btns">
              <button type="button" className="btn primary" disabled={busy || loading} onClick={onApprove}>
                {run.targetFestivalId ? "이 축제·일정으로 변경 확정" : "이 일정으로 확정하기"}
              </button>
              <button type="button" className="btn" disabled={busy || loading} onClick={onReject}>
                거절
              </button>
            </div>
          ) : (
            <div className="cm-state wait">모임장이 확정하면 일정에 반영돼요</div>
          )}
        </div>
      )}
      {run && run.status === "completed" && (
        <div className="cm-state ok sc-gap">
          <i className="ti ti-circle-check" aria-hidden="true" /> 일정을 확정했어요! 참여자에게 공유돼요.
        </div>
      )}
      {run && ["failed", "waiting_input", "rejected", "cancelled"].includes(run.status) && (
        <div className="sc-fail">
          <b>
            <i className="ti ti-alert-triangle" aria-hidden="true" /> 초안을 확정하지 못했어요
          </b>
          <span>{run.errors?.[0]?.message || run.interrupt?.message || run.result?.summary || run.status}</span>
        </div>
      )}

      {/* 초안 승인 대기 중에는 확정/거절만 보이도록 다시 만들기 버튼을 숨긴다 */}
      {loading ? <p className="sc-empty-line">일정을 불러오는 중…</p> : null}
      {isLeader && unrecoverableDraft && (
        <button type="button" className="btn sc-make" disabled={busy} onClick={onDiscard}>
          복구할 수 없는 초안 폐기
        </button>
      )}
      {isLeader && draftReadFailed && (
        <button type="button" className="btn sc-make" disabled={busy} onClick={onRetry}>다시 불러오기</button>
      )}
      {loading || unrecoverableDraft || draftReadFailed || run?.status === "waiting_approval" ? null : isLeader ? (
        <button type="button" className="btn primary sc-make" disabled={busy} onClick={onDraft}>
          <i className="ti ti-sparkles" aria-hidden="true" />
          {busy ? "AI가 일정을 만드는 중…" : run ? "AI 일정 초안 다시 만들기" : "AI 일정 초안 만들기"}
        </button>
      ) : (
        <div className="cm-state wait sc-gap">일정 초안은 모임장이 만들고 확정해요</div>
      )}
    </section>
  );
}
