// v4.3 · 적용 중인 필터 요약과 개별·전체 초기화
export default function FilterSummary({ ui }) {
  const { state, dispatch } = ui;
  const items = [];
  if (state.discoverView !== "calendar" && state.month) items.push(["month", state.month + "월"]);
  if (state.status !== "all")
    items.push(["status", state.status === "available" ? "참여 가능" : "기간 종료"]);
  if (state.region !== "all") items.push(["region", state.region]);
  if (state.category !== "all") items.push(["category", state.category]);
  if (state.keyword.trim()) items.push(["keyword", `“${state.keyword.trim()}”`]);
  if (!items.length) return null;
  return (
    <div className="filter-summary">
      <span>적용 중</span>
      {items.map(([k, l]) => (
        <button
          key={k}
          type="button"
          className="fchip"
          aria-label={`${l} 필터 해제`}
          onClick={() => dispatch(`clearFilter:${k}`)}
        >
          {l} ✕
        </button>
      ))}
      <button type="button" className="btn text" onClick={() => dispatch("clearFilters")}>
        필터 초기화
      </button>
    </div>
  );
}
