// 2단계 상세 오른쪽: 모집 현황 · 내 상태별 버튼 · (모임장) 승인 대기 목록 — 스크롤 따라오지 않음
import { useNavigate } from "react-router-dom";
import { approveJoin, rejectJoin, requestJoin } from "../api/groupsApi.js";
import { fmt, pct, shortId } from "../lib/communityFormat.js";

export default function CommunityStatusPanel({ g, me, isLeader, isMember, myPending, pending, created, notice, busy, joinMsg, setJoinMsg, act, markRequested }) {
  const navigate = useNavigate();
  return (
    <aside className="cm-side">
      <h3>모집 현황</h3>
      <div className="cm-row">
        <span>인원</span>
        <b>
          {g.memberCount} / {g.capacity}명
        </b>
      </div>
      <div className="cm-bar">
        <div style={{ width: pct(g) + "%" }} />
      </div>
      <div className="cm-members">
        {g.members.map((m) => (
          <span key={m.userId} className={m.role === "leader" ? "leader" : ""}>
            {m.role === "leader" ? <i className="ti ti-crown" aria-hidden="true" /> : null}
            {m.user.displayName}
          </span>
        ))}
      </div>
      <div className="cm-row">
        <span>참여 방식</span>
        <span>{g.joinMode === "approval" ? "모임장 승인 후 참여" : "바로 참여"}</span>
      </div>
      <div className="cm-row">
        <span>상태</span>
        <span>{g.status === "open" ? "참여 신청 가능" : "모집 종료 (게시글 유지)"}</span>
      </div>

      {created === g.id && !notice ? (
        <div className="cm-notice ok" role="status">
          <i className="ti ti-circle-check" aria-hidden="true" /> 모집글이 올라갔어요. 참여 신청이 오면 여기서 승인할 수 있어요.
        </div>
      ) : null}
      {notice && (
        <div className="cm-notice" role="status">
          {notice}
        </div>
      )}

      {/* 내 상태에 따라 버튼 하나만 */}
      <div className="cm-action">
        {isLeader || isMember ? (
          <>
            {isLeader ? null : (
              <div className="cm-state ok">
                <i className="ti ti-circle-check" aria-hidden="true" /> 참여 확정
              </div>
            )}
            {/* 플로우 다음 단계: 참여 확정 → 공동 일정 */}
            <button type="button" className="btn primary cm-cta" onClick={() => navigate(`/schedules?groupId=${encodeURIComponent(g.id)}`)}>
              <i className="ti ti-calendar-event" aria-hidden="true" /> 공동 일정 {isLeader ? "만들기" : "보기"} →
            </button>
            <button type="button" className="btn cm-cta" onClick={() => navigate(`/chat?groupId=${encodeURIComponent(g.id)}`)}>
              <i className="ti ti-message-circle" aria-hidden="true" /> 모임 채팅방 →
            </button>
          </>
        ) : myPending ? (
          <div className="cm-state wait">
            <i className="ti ti-hourglass" aria-hidden="true" /> 승인 대기 중
          </div>
        ) : g.status !== "open" ? (
          <div className="cm-state off">모집이 마감됐어요</div>
        ) : (
          <>
            {me && g.joinMode === "approval" && (
              <input
                className="cm-join-msg"
                maxLength={300}
                placeholder="모임장에게 한마디 (선택) · 예) 오후 3시부터 참여 가능해요"
                aria-label="신청 메시지"
                value={joinMsg}
                onChange={(e) => setJoinMsg(e.target.value)}
              />
            )}
            <button
              type="button"
              className="btn primary cm-cta"
              disabled={busy || !me}
              onClick={() =>
                act(
                  () =>
                    requestJoin(g.id, joinMsg)
                      .then(() => markRequested(g.id))
                      .catch((e) => {
                        if (e.code === "JOIN_REQUEST_ALREADY_EXISTS") markRequested(g.id);
                        throw e;
                      }),
                  g.joinMode === "approval" ? "참여 신청을 보냈어요. 모임장 승인을 기다려 주세요." : "모임에 참여했어요!",
                ).then(() => setJoinMsg(""))
              }
            >
              {g.joinMode === "approval" ? "참여 신청하기" : "바로 참여하기"}
            </button>
          </>
        )}
      </div>

      {isLeader && (
        <div className="cm-requests">
          <h4>승인 대기 {pending.length}명</h4>
          {pending.length ? (
            pending.map((r) => (
              <div className="cm-request" key={r.id}>
                <div>
                  <strong>신청자 #{shortId(r.userId)}</strong>
                  <small>
                    {r.message ? `“${r.message}” · ` : ""}
                    {fmt(r.createdAt)}
                  </small>
                </div>
                <div className="cm-request-btns">
                  <button type="button" className="btn small green" disabled={busy} onClick={() => act(() => approveJoin(g.id, r.id, g.version), "승인했어요. 참여가 확정됐어요! 이제 ‘공동 일정 만들기’로 참여자 조건에 맞는 일정을 만들 수 있어요.")}>
                    승인
                  </button>
                  <button type="button" className="btn small" disabled={busy} onClick={() => act(() => rejectJoin(g.id, r.id, g.version), "거절했어요. 신청자에게 안내돼요.")}>
                    거절
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="cm-empty-line">아직 대기 중인 신청이 없어요.</p>
          )}
        </div>
      )}
    </aside>
  );
}
