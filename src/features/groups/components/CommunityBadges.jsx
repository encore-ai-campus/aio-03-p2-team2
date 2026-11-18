// 배지: 상태·참여 방식·내 모임
import { STATUS } from "../lib/communityFormat.js";

export const StatusBadge = ({ status }) => {
  const [label, tone] = STATUS[status] || [status, "closed"];
  return <span className={`cm-badge ${tone}`}>{label}</span>;
};
export const JoinBadge = ({ mode }) => <span className={`cm-badge ${mode === "approval" ? "approval" : "instant"}`}>{mode === "approval" ? "승인제" : "바로 참여"}</span>;
export const MineBadge = () => (
  <span className="cm-badge mine">
    <i className="ti ti-crown" aria-hidden="true" /> 내 모임
  </span>
);
