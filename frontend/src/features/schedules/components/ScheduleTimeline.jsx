// 일정 목록 표시 — 세로 타임라인 / 비교용 한 줄 목록
import { dayLabel, isChanged } from "../lib/scheduleFormat.js";

// 세로 타임라인: 시작 시각(굵게)·끝 시각(작게) | 점·선 | 활동·설명
// changedKeys(기존 일정의 활동|시각 묶음)가 있으면 기존에 없던 항목에 「변경」 배지
export function Timeline({ items, changedKeys }) {
  if (!items?.length) return <p className="sc-empty-line">아직 확정된 일정이 없어요.</p>;
  return (
    <ol className="sc-tl">
      {items.map((x, i) => {
        const changed = isChanged(x, changedKeys);
        return (
          <li key={i}>
            <span className="sc-tl-time">
              <b>{x.time}</b>
              {x.endTime ? <small>~{x.endTime}</small> : null}
            </span>
            <span className="sc-tl-body">
              <b>
                {x.label}
                {changed ? <em className="sc-chg">변경</em> : null}
              </b>
              {x.date || x.description || x.desc ? (
                <small>
                  {x.date ? `${dayLabel(x.date)}${x.description || x.desc ? " · " : ""}` : ""}
                  {x.description || x.desc || ""}
                </small>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// 비교용 한 줄 목록: 「시각 · 활동명」, 바뀐 줄만 코랄
export function CompactList({ items, changedKeys }) {
  if (!items?.length) return <p className="sc-empty-line">일정 없음</p>;
  return (
    <ul className="sc-mini">
      {items.map((x, i) => {
        const changed = isChanged(x, changedKeys);
        return (
          <li key={i} className={changed ? "chg" : ""} title={`${x.time}${x.endTime ? `~${x.endTime}` : ""} ${x.label}`}>
            <b>{x.time}</b>
            <span>{x.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
