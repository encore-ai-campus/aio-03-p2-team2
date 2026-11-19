// 모임 카드 — 모임 제목·축제·날짜·참여자 + 모임 변경 선택
import { useNavigate } from "react-router-dom";
import { dayLabel } from "../lib/scheduleFormat.js";

export default function ScheduleGroupCard({ group, f, me, isMember, groupId, groups, onGroupChange }) {
  const navigate = useNavigate();
  return (
    <div className="sc-group">
      <div className="sc-group-ico">
        <i className="ti ti-users" aria-hidden="true" />
      </div>
      <div className="sc-group-info">
        {group ? (
          <>
            <h3>
              {group.title}
              <span className={`cm-badge ${group.status === "open" ? "open" : "closed"}`}>{group.status === "open" ? "모집 중" : "모집 마감"}</span>
            </h3>
            <div className="sc-group-meta">
              <span>
                <i className="ti ti-confetti" aria-hidden="true" /> {f?.name || group.festivalId}
              </span>
              {group.date ? (
                <span>
                  <i className="ti ti-calendar" aria-hidden="true" /> {dayLabel(group.date)}
                  {group.startTime ? ` · ${group.startTime.slice(0, 5)}` : ""}
                </span>
              ) : null}
              <span>
                <i className="ti ti-user-check" aria-hidden="true" /> 참여 확정 {group.memberCount}/{group.capacity}명
              </span>
            </div>
            <div className="cm-members sc-members">
              {group.members.map((m) => (
                <span key={m.userId} className={m.role === "leader" ? "leader" : ""}>
                  {m.role === "leader" ? <i className="ti ti-crown" aria-hidden="true" /> : null}
                  {m.user.displayName}
                </span>
              ))}
              {isMember ? (
                <button type="button" className="btn small" onClick={() => navigate(`/chat?groupId=${encodeURIComponent(group.id)}`)}>
                  <i className="ti ti-message-circle" aria-hidden="true" /> 채팅방
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <h3>모임 불러오는 중…</h3>
        )}
      </div>
      <label className="sc-group-change">
        <span>모임 변경</span>
        <select value={groupId || ""} onChange={(e) => onGroupChange(e.target.value)} aria-label="모임 변경">
          {groups.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
              {me && x.leaderId === me.id ? " (내가 모임장)" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
