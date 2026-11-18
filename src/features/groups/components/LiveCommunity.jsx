// 동행 커뮤니티 — 실제 API 버전 (GET /groups → 상세 GET /groups/{id})
// 1단계 게시판 목록(?groupId 없음) → 글을 누르면 2단계 상세(?groupId=…)
// 참여 신청(POST join-requests) · 모임장 승인/거절(version 포함) · 공개 댓글
// 상태·API는 hooks/useCommunity.js, 화면 조각은 CommunityBoard·CommunityPost·CommunityStatusPanel
// 목록 API가 실패하면 onFail()로 CommunityPage가 기존 데모 화면을 보여준다.
import { useCommunity } from "../hooks/useCommunity.js";
import CommunityBoard from "./CommunityBoard.jsx";
import CommunityPost from "./CommunityPost.jsx";
import CommunityStatusPanel from "./CommunityStatusPanel.jsx";
import LiveNewGroupModal from "./LiveNewGroupModal.jsx";

export default function LiveCommunity({ festivals, onFail, newOpen, onCloseNew }) {
  const c = useCommunity({ festivals, onFail, onCloseNew });
  const { me, selectedId, groups, detail: g, requested, requests } = c;
  const newModal = newOpen ? <LiveNewGroupModal festivals={festivals} onClose={onCloseNew} onCreated={c.onCreated} /> : null;

  if (!groups)
    return (
      <>
        <div className="empty">모임 불러오는 중…</div>
        {newModal}
      </>
    );

  // ===== 1단계: 게시판 목록 =====
  if (!selectedId)
    return (
      <>
        {newModal}
        <CommunityBoard groups={groups} me={me} filter={c.filter} sort={c.sort} festival={c.festival} onChangeList={c.changeList} onOpenGroup={c.openGroup} />
      </>
    );

  // ===== 2단계: 글 상세 =====
  const isLeader = g && me && g.leaderId === me.id;
  const isMember = g && me && g.members.some((m) => m.userId === me.id);
  const myPending = g && requested.has(g.id);
  const pending = isLeader ? requests : [];
  const f = g ? c.festival(g.festivalId) : null;

  return (
    <div className="cm-detail-page">
      {newModal}
      <button type="button" className="cm-back" onClick={c.backToList}>
        <i className="ti ti-arrow-left" aria-hidden="true" /> 목록으로
      </button>
      {!g ? (
        <div className="empty">{c.notice || "모임 불러오는 중…"}</div>
      ) : (
        <div className="cm-detail">
          <CommunityPost g={g} f={f} me={me} isLeader={isLeader} busy={c.busy} comment={c.comment} setComment={c.setComment} act={c.act} />
          <CommunityStatusPanel
            g={g}
            me={me}
            isLeader={isLeader}
            isMember={isMember}
            myPending={myPending}
            pending={pending}
            created={c.created}
            notice={c.notice}
            busy={c.busy}
            joinMsg={c.joinMsg}
            setJoinMsg={c.setJoinMsg}
            act={c.act}
            markRequested={c.markRequested}
          />
        </div>
      )}
    </div>
  );
}
