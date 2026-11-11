import { Fragment } from "react";
import { useDemo } from "../../../app/DemoProvider.jsx";
export default function CommunityPage() {
  const demo = useDemo();
  const { state, btn, group, groupClosed, pageHead, roomCard, roomDetail } =
    demo;
  const groups = [...state.groups]
    .filter(
      (g) =>
        state.communityStatus === "all" ||
        (state.communityStatus === "open" && !groupClosed(g)) ||
        (state.communityStatus === "closed" && groupClosed(g)),
    )
    .sort((a, b) => new Date(b.created) - new Date(a.created));
  let g = group(state.selectedGroup);
  if (!g) g = groups[0];
  return (
    <>
      {pageHead(
        "TRAVEL COMMUNITY",
        "👥 동행 커뮤니티",
        "AI 매칭 이후 생성된 공개 모집글을 최신순으로 확인하고 댓글·참여 신청을 진행하세요.",
        btn("＋ 직접 모임 만들기", "newGroup", "btn primary"),
      )}
      <div className="note coral">
        <b>안전한 참여 규칙</b>
        {
          " · 최초 게시글 작성자가 모임장이 됩니다. 공개 댓글은 누구나, 채팅은 승인된 참여자만 이용합니다. 정원 초과 시 자동 마감되지만 게시글은 삭제되지 않습니다."
        }
      </div>
      <div className="section-head">
        <div>
          <h2>
            {"모임 목록 "}
            <span className="muted sm">{groups.length}개</span>
          </h2>
          <p>생성일 최신순 · 신청 대기자·유형·정원 확인</p>
        </div>
        <div className="chips">
          {[
            ["all", "전체"],
            ["open", "모집 중"],
            ["closed", "마감"],
          ].map(([val, label], index) => (
            <Fragment key={index}>
              {btn(
                label,
                `commStatus:${val}`,
                `chip ${(state.communityStatus || "all") === val ? "active" : ""}`,
              )}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="columns">
        <div className="room-list">
          {groups.length ? (
            groups.map((item, index) => (
              <Fragment key={index}>{roomCard(item)}</Fragment>
            ))
          ) : (
            <>
              <div className="empty">해당 상태의 모임이 없습니다.</div>
            </>
          )}
        </div>
        {roomDetail(g)}
      </div>
    </>
  );
}
