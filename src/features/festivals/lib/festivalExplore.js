// 축제 탐색 — 출처 문구·필터 조건·상시/장기 운영 판정

// 실제 데이터면 출처·갱신 시각 표시 (공지 요구: 데이터 출처·조회 시점)
export function sourceText(festivals, source, fallback) {
  if (source !== "api") return fallback;
  const official = festivals.some((f) => f.source === "official_api");
  const latest = festivals.map((f) => f.sourceUpdatedAt).filter(Boolean).sort().slice(-1)[0];
  const when = latest ? new Date(latest).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  return `${official ? "출처: 한국관광공사 TourAPI" : "출처: 페스로움 DB"}${when ? ` · ${when} 갱신` : ""}`;
}

// 월 조건: 선택한 연도와 달에 기간이 걸치는 축제
const inMonth = (f, year, month) => {
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  return f.start.slice(0, 7) <= ym && f.end.slice(0, 7) >= ym;
};

export function matchesFilters(f, state, active, q, year, month) {
  return (
    (!month || inMonth(f, year, month)) &&
    (state.status === "all" || (state.status === "available" && active(f)) || (state.status === "past" && !active(f))) &&
    (state.region === "all" || f.region === state.region) &&
    (state.category === "all" || f.category === state.category) &&
    (!q || `${f.name} ${f.region} ${f.city} ${f.description} ${(f.tags || []).join(" ")}`.toLowerCase().includes(q))
  );
}

// 상시·장기(120일 이상) 운영은 어느 달에나 걸리므로 아래 묶음으로 분리 → 월별 차이가 보이게
const days = (f) => (new Date(f.end + "T00:00:00") - new Date(f.start + "T00:00:00")) / 864e5;
export const isLong = (f) => days(f) >= 120;
