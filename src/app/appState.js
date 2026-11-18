export const STORAGE_KEY = "festamate_ui_v1";
export const LEGACY_STORAGE_KEY = "festamate_v4_4_261117_demo";
export const paths = { discover: "/festivals", match: "/matching", community: "/groups", room: "/chat", schedule: "/schedules", alerts: "/alerts" };
export const NAV = [
  ["discover", "🎪", "축제 탐색"], ["match", "💞", "AI 동행 매칭"], ["community", "👥", "동행 커뮤니티"],
  ["room", "💬", "모임 채팅방"], ["schedule", "🗓️", "일정 확인·조정"], ["alerts", "🔔", "AI 알림·대안"],
];

export const initialState = () => ({
  page: "discover", month: 0, status: "available", region: "all", category: "all", keyword: "",
  festivalId: null, discoverView: "list", calDay: null,
  profile: { interests: [], budget: null, style: "", mbti: [], party: null, start: "", date: "", joinMode: "approval" },
});

// 저장된 화면 설정만 복원한다. 예전 가상 축제·모임·사용자·대화·점수는 가져오지 않는다.
export function restoreUiState(saved, legacy = false) {
  const state = initialState();
  if (!saved || typeof saved !== "object") return state;
  for (const key of ["page", "status", "region", "category", "keyword", "discoverView", "calDay"])
    if (typeof saved[key] === "string") state[key] = saved[key];
  if (!paths[state.page]) state.page = "discover";
  if (!["all", "available", "past"].includes(state.status)) state.status = "available";
  if (!["list", "calendar"].includes(state.discoverView)) state.discoverView = "list";
  if (Number.isInteger(saved.month) && saved.month >= 0 && saved.month <= 12) state.month = saved.month;
  if (!legacy && typeof saved.festivalId === "string") state.festivalId = saved.festivalId;
  const profile = saved.profile || {};
  for (const key of Object.keys(state.profile)) {
    if (["interests", "mbti"].includes(key)) {
      if (Array.isArray(profile[key])) state.profile[key] = profile[key].filter((x) => typeof x === "string");
    } else if (typeof profile[key] === "string" || typeof profile[key] === "number") state.profile[key] = profile[key];
  }
  return state;
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const calendarMonth = (state) => state.month || (today().startsWith("2026-") ? Number(today().slice(5, 7)) : 1);

export function applyUiAction(state, action) {
  const [kind, id] = action.split(":");
  const next = structuredClone(state);
  if (kind === "month") { next.month = Number(id); next.calDay = null; }
  if (kind === "view") next.discoverView = id;
  if (kind === "calMove") { next.month = Math.max(1, Math.min(12, calendarMonth(state) + Number(id))); next.calDay = null; }
  if (kind === "calDay") next.calDay = state.calDay === id ? null : id;
  if (kind === "status") next.status = id;
  if (kind === "festival") next.festivalId = id;
  if (kind === "interest" || kind === "mbti") {
    const key = kind === "interest" ? "interests" : "mbti";
    next.profile[key] = state.profile[key].includes(id) ? state.profile[key].filter((x) => x !== id) : [...state.profile[key], id];
  }
  if (kind === "clearFilter") next[id] = id === "month" ? 0 : id === "keyword" ? "" : "all";
  if (kind === "clearFilters") Object.assign(next, { month: 0, keyword: "", status: "available", region: "all", category: "all" });
  return next;
}
