import { Fragment, useCallback, useState } from "react";
import { useDemo } from "../../../app/DemoProvider.jsx";
import { useFestivals } from "../../festivals/hooks/useFestivals.js";
import LiveCommunity from "../components/LiveCommunity.jsx";
import { DEMO_MODE } from "../../../shared/lib/demoMode.js";
import { ApiError } from "../../../shared/components/ApiState.jsx";
export default function CommunityPage() {
  const demo = useDemo();
  const { state, btn, pill, group, groupClosed, pageHead, roomCard, roomDetail } =
    demo;
  // 실제 모임 API 우선, 실패하면 기존 데모 화면
  const { festivals } = useFestivals(state.festivals);
  const [apiFailed, setApiFailed] = useState(false);
  const [apiError, setApiError] = useState(false);
  const [newOpen, setNewOpen] = useState(false); // 실서버 「＋ 직접 모임 만들기」 창
  const closeNew = useCallback(() => setNewOpen(false), []);
  // 데모 모드일 때만 예시 화면으로, 아니면 「서버에 연결할 수 없어요」
  const onFail = useCallback(() => (DEMO_MODE ? setApiFailed(true) : setApiError(true)), []);
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
      {!apiFailed ? (
        /* 실서버 모드: v3 머리글 + 안전 규칙 한 줄 */
        <>
          <div className="mp-head cm-head">
            <div>
              <h1>동행 커뮤니티</h1>
              <p>AI 매칭으로 만들어진 모집글을 보고, 댓글을 남기거나 참여를 신청해요</p>
            </div>
            <button type="button" className="btn cm-new" onClick={() => setNewOpen(true)}>
              ＋ 직접 모임 만들기
            </button>
          </div>
          <ul className="cm-rules" aria-label="이용 규칙">
            <li>
              <i className="ti ti-crown" aria-hidden="true" /> 글쓴이가 모임장
            </li>
            <li>
              <i className="ti ti-message-circle" aria-hidden="true" /> 댓글은 누구나
            </li>
            <li>
              <i className="ti ti-lock" aria-hidden="true" /> 채팅은 승인된 참여자만
            </li>
            <li>
              <i className="ti ti-users" aria-hidden="true" /> 정원이 차면 자동 마감
            </li>
          </ul>
        </>
      ) : (
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
              " · 최초 게시글 작성자가 모임장이 돼요. 공개 댓글은 누구나, 채팅은 승인된 참여자만 이용해요. 정원 초과 시 자동 마감되지만 게시글은 삭제되지 않아요."
            }
          </div>
        </>
      )}
      {apiError ? (
        <ApiError />
      ) : !apiFailed ? (
        <LiveCommunity festivals={festivals} onFail={onFail} newOpen={newOpen} onCloseNew={closeNew} />
      ) : (
      <>
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
              <div className="empty">해당 상태의 모임이 없어요.</div>
            </>
          )}
        </div>
        {roomDetail(g)}
      </div>
      </>
      )}
    </>
  );
}
