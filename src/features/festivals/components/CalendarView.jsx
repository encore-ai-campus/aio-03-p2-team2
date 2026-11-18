import { Button } from "../../../shared/components/Primitives.jsx";

// v4.2 · 축제 캘린더형 보기
export const CAL_COLORS = {
  미식: "#f08a5d",
  음악: "#8b7cf6",
  문화: "#2fb5a8",
  전통: "#d99a3c",
  자연: "#5bb36a",
};
export const calColor = (c) => CAL_COLORS[c] || "#6f7d90";
export const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
export const ymd = (d) =>
  [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");

export function ViewToggle({ ui }) {
  const v = ui.state.discoverView || "list";
  return (
    <div className="viewtoggle" role="tablist" aria-label="보기 방식">
      {[
        ["list", "▦ 리스트형"],
        ["calendar", "📅 캘린더형"],
      ].map(([k, l]) => (
        <Button
          key={k}
          role="tab"
          aria-selected={v === k}
          className={v === k ? "active" : ""}
          onClick={() => ui.dispatch(`view:${k}`)}
        >
          {l}
        </Button>
      ))}
    </div>
  );
}

export default function CalendarView({ ui, list }) {
  const { state, dispatch, calMonth, today, active, period, fCard } = ui;
  const m = calMonth();
  const first = new Date(2026, m - 1, 1);
  const last = new Date(2026, m, 0);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay()));
  const t = today();
  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(ymd(d));
  const on = (ds) => list.filter((f) => f.start <= ds && f.end >= ds);
  const monthKey = `2026-${String(m).padStart(2, "0")}`;
  const monthCount = list.filter(
    (f) => f.start.slice(0, 7) <= monthKey && f.end.slice(0, 7) >= monthKey,
  ).length;
  const sel = state.calDay && state.calDay.startsWith(monthKey) ? state.calDay : null;
  const cats = [...new Set(list.map((f) => f.category))];
  const selList = sel ? on(sel) : [];

  function selectDay(ds) {
    dispatch(`calDay:${ds}`);
    if (state.calDay !== ds)
      requestAnimationFrame(() =>
        document
          .querySelector(".cal-box + .section-head")
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      );
  }

  return (
    <>
      <div className="box pad cal-box">
        <div className="cal-top">
          <div className="cal-title">
            <b>2026.{String(m).padStart(2, "0")}</b>
            <Button
              className="cal-arrow"
              disabled={m <= 1}
              aria-label="이전 달"
              onClick={() => dispatch("calMove:-1")}
            >
              ‹
            </Button>
            <Button
              className="cal-arrow"
              disabled={m >= 12}
              aria-label="다음 달"
              onClick={() => dispatch("calMove:1")}
            >
              ›
            </Button>
            <span className="pill blue">이번 달 {monthCount}건</span>
          </div>
          <div className="cal-legend">
            {cats.map((c) => (
              <span key={c}>
                <i style={{ background: calColor(c) }} />
                {c}
              </span>
            ))}
            <span className="muted">· 회색 = 기간 종료</span>
          </div>
        </div>
        {!monthCount && (
          <div className="note" style={{ marginBottom: "12px" }}>
            이번 달에는 조건에 맞는 축제가 없어요. ‹ › 버튼이나 필터를 바꿔 다른 축제를 찾아보세요.
          </div>
        )}
        <div className="cal-grid">
          {WEEK.map((w, i) => (
            <div key={w} className={`cal-head ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`}>
              {w}
            </div>
          ))}
          {days.map((ds) => {
            const evs = on(ds);
            const dow = new Date(ds + "T00:00:00").getDay();
            const out = !ds.startsWith(monthKey);
            return (
              <div
                key={ds}
                className={`cal-cell ${out ? "out" : ""} ${ds === sel ? "sel" : ""} ${evs.length ? "has" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`${+ds.slice(5, 7)}월 ${+ds.slice(8)}일 축제 ${evs.length}건`}
                onClick={() => selectDay(ds)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectDay(ds);
                  }
                }}
              >
                <span
                  className={`cal-num ${dow === 0 ? "sun" : dow === 6 ? "sat" : ""} ${ds === t ? "today" : ""}`}
                >
                  {+ds.slice(8)}
                </span>
                <div className="cal-evs">
                  {evs.slice(0, 3).map((f) => (
                    <Button
                      key={f.id}
                      className={`cal-ev ${active(f) ? "" : "past"}`}
                      style={{ "--c": calColor(f.category) }}
                      title={`${f.name} · ${period(f)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch(`festival:${f.id}`);
                      }}
                    >
                      {f.name}
                    </Button>
                  ))}
                  {evs.length > 3 && <span className="cal-more">+{evs.length - 3}개 더보기</span>}
                </div>
                <div className="cal-dots">
                  {evs.slice(0, 4).map((f) => (
                    <i key={f.id} style={{ background: calColor(f.category) }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="source-note" style={{ margin: "10px 0 0" }}>
          축제명을 누르면 해당 축제의 AI 동행 매칭으로, 날짜를 누르면 그날 진행 중인 축제 목록을 아래에서 볼 수
          있어요. 위의 지역·유형·검색 필터가 캘린더에도 똑같이 적용돼요.
        </p>
      </div>
      <div className="section-head">
        <div>
          <h2>
            {sel
              ? `📍 ${+sel.slice(5, 7)}월 ${+sel.slice(8)}일 (${WEEK[new Date(sel + "T00:00:00").getDay()]}) 진행 축제`
              : "📍 날짜를 선택해 보세요"}
          </h2>
          <p>
            {sel
              ? `${selList.length}건 · 여러 날 진행되는 축제는 기간 내 모든 날짜에 표시돼요`
              : "캘린더에서 날짜를 누르면 그날 축제를 카드로 보여드려요"}
          </p>
        </div>
      </div>
      {sel &&
        (selList.length ? (
          <div className="festival-grid">{selList.map((f) => fCard(f))}</div>
        ) : (
          <div className="empty">
            <div className="big">🗓️</div>
            <h3>이날 진행되는 축제가 없어요</h3>
            <p>점이 표시된 날짜를 눌러 보세요.</p>
          </div>
        ))}
    </>
  );
}
