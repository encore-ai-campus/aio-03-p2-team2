import { formatAlertDate } from "../lib/alertDates.js";

export default function AlertGroupInfo({ detail, schedule, items, riskOn, busy, toggleRisk, reloadSchedule, onOpenSchedule }) {
  const cap = detail?.capacity || 0;
  const empty = Math.max(0, cap - (detail?.members?.length || 0));
  return (
    <>
      <div className="al-card-h">
        <h2 className="sc-h">모임 정보</h2>
      </div>
      <div className="al-sec">
        <h3>확정된 일정</h3>
        {items.length ? (
          <ol className="sc-tl">
            {items.map((x, i) => (
              <li key={i}>
                <span className="sc-tl-time">
                  <b>{x.time}</b>
                  {x.endTime ? <small>~{x.endTime}</small> : null}
                </span>
                <span className="sc-tl-body">
                  <b>{x.label}</b>
                  {x.date || x.description ? (
                    <small>
                      {x.date ? `${formatAlertDate(x.date)}${x.description ? " · " : ""}` : ""}
                      {x.description || ""}
                    </small>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : schedule === null && !detail ? (
          <p className="sc-empty-line">일정 불러오는 중…</p>
        ) : schedule?.loadError ? (
          <div className="sc-fail">
            <b>
              <i className="ti ti-plug-connected-x" aria-hidden="true" /> 일정을 불러오지 못했어요
            </b>
            <span>{schedule.loadError} 서버 연결을 확인한 뒤 다시 시도해 주세요.</span>
            <button type="button" className="btn small al-go" onClick={reloadSchedule}>
              다시 불러오기
            </button>
          </div>
        ) : (
          <div className="sc-fail">
            <b>
              <i className="ti ti-calendar-off" aria-hidden="true" /> 아직 확정된 일정이 없어요
            </b>
            <span>날씨는 확정된 일정 기준으로 확인해요. 공동 일정을 먼저 확정해 주세요.</span>
            <button type="button" className="btn small al-go" onClick={onOpenSchedule}>
              공동 일정으로 가기 →
            </button>
          </div>
        )}
      </div>
      {detail?.members?.length ? (
        <>
          <div className="al-sec">
            <h3>
              참여자
              <em>
                {detail.memberCount ?? detail.members.length} / {cap}명
              </em>
            </h3>
            <div className="al-members">
              {detail.members.map((m) => (
                <span key={m.userId} className={m.role === "leader" ? "leader" : ""}>
                  {m.role === "leader" ? <i className="ti ti-crown" aria-hidden="true" /> : null}
                  {m.user.displayName}
                </span>
              ))}
              {Array.from({ length: Math.min(empty, 4) }, (_, i) => (
                <span key={`e${i}`} className="empty">
                  모집 중
                </span>
              ))}
            </div>
          </div>
          <div className="al-sec al-sec-end">
            <div className="al-toggle-row">
              <span>
                <b>내 비 예보 알림</b>
                <small>{riskOn ? "비가 예보되면 알림 센터로 알려 드려요" : "꺼져 있으면 비 예보 알림이 오지 않아요"}</small>
              </span>
              <button type="button" role="switch" aria-checked={!!riskOn} aria-label="내 비 예보 알림 받기" className={`al-switch ${riskOn ? "on" : ""}`} disabled={riskOn === null || busy === "risk"} onClick={toggleRisk}>
                <span />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
