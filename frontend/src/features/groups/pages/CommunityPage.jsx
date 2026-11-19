import { useCallback, useState } from "react";
import { useFestivals } from "../../festivals/hooks/useFestivals.js";
import LiveCommunity from "../components/LiveCommunity.jsx";
import { ApiError } from "../../../shared/components/ApiState.jsx";

export default function CommunityPage() {
  const { festivals } = useFestivals();
  const [failed, setFailed] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const closeNew = useCallback(() => setNewOpen(false), []);
  const onFail = useCallback(() => setFailed(true), []);
  return <>
    <div className="mp-head cm-head">
      <div><h1>동행 커뮤니티</h1><p>AI 매칭으로 만들어진 모집글을 보고, 댓글을 남기거나 참여를 신청해요</p></div>
      <button type="button" className="btn cm-new" onClick={() => setNewOpen(true)}>＋ 직접 모임 만들기</button>
    </div>
    <ul className="cm-rules" aria-label="이용 규칙">
      <li><i className="ti ti-crown" aria-hidden="true" /> 글쓴이가 모임장</li>
      <li><i className="ti ti-message-circle" aria-hidden="true" /> 댓글은 누구나</li>
      <li><i className="ti ti-lock" aria-hidden="true" /> 채팅은 승인된 참여자만</li>
      <li><i className="ti ti-users" aria-hidden="true" /> 정원이 차면 자동 마감</li>
    </ul>
    {failed ? <ApiError /> : <LiveCommunity festivals={festivals} onFail={onFail} newOpen={newOpen} onCloseNew={closeNew} />}
  </>;
}
