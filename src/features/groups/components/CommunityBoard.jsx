// 1단계: 게시판 목록 — 상태 필터 탭·정렬 메뉴·모집글 표
import { FILTERS, SORTS, fmtDay, matchesFilter, pct, sortFn, when, where } from "../lib/communityFormat.js";
import { JoinBadge, MineBadge, StatusBadge } from "./CommunityBadges.jsx";

export default function CommunityBoard({ groups, me, filter, sort, festival, onChangeList, onOpenGroup }) {
  const shown = groups.filter((x) => matchesFilter(x, filter)).sort(sortFn(sort, festival));
  const count = (v) => groups.filter((x) => matchesFilter(x, v)).length;

  return (
    <>
      <div className="cm-toolbar">
        <div className="cm-filters" role="tablist" aria-label="모집 상태">
          {FILTERS.map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={filter === v} className={filter === v ? "on" : ""} onClick={() => onChangeList({ status: v })}>
              {label} <span>{count(v)}</span>
            </button>
          ))}
        </div>
        <label className="cm-sort">
          <i className="ti ti-arrows-sort" aria-hidden="true" />
          <span className="sr-only">정렬</span>
          <select value={sort} onChange={(e) => onChangeList({ sort: e.target.value })} aria-label="정렬">
            {SORTS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="cm-board">
        <div className="cm-board-head" aria-hidden="true">
          <span>상태</span>
          <span>제목 · 축제</span>
          <span>일정 · 지역</span>
          <span>인원</span>
          <span>작성일</span>
        </div>
        {shown.length ? (
          shown.map((item) => {
            const f = festival(item.festivalId);
            const mine = me && item.leaderId === me.id;
            return (
              <button key={item.id} type="button" className={`cm-board-row ${item.status !== "open" ? "dim" : ""}`} onClick={() => onOpenGroup(item.id)}>
                <span className="cm-badges">
                  <StatusBadge status={item.status} />
                  {item.status === "open" ? <JoinBadge mode={item.joinMode} /> : null}
                </span>
                <span className="cm-title-cell">
                  <b>
                    {item.title}
                    {mine ? <MineBadge /> : null}
                  </b>
                  <small>{f?.name || "축제"}</small>
                </span>
                <span className="cm-when-cell">
                  {when(item, f)}
                  <small>{where(f)}</small>
                </span>
                <span className="cm-count-cell">
                  <span>
                    {item.memberCount}/{item.capacity}명{mine && item.pendingRequestCount ? <em> · 대기 {item.pendingRequestCount}</em> : null}
                  </span>
                  <span className="cm-bar">
                    <span style={{ width: pct(item) + "%" }} />
                  </span>
                </span>
                <span className="cm-date-cell">{fmtDay(item.createdAt)}</span>
              </button>
            );
          })
        ) : (
          <div className="cm-board-empty">{filter === "all" ? "아직 모집글이 없어요. AI 동행 매칭 결과에서 모집글을 만들어 보세요." : "해당 상태의 모집글이 없어요."}</div>
        )}
      </div>
    </>
  );
}
