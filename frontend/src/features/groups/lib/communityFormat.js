// 동행 커뮤니티 — 오류 문구·상태 표·정렬/필터 목록·표시 형식 함수

const ERROR_TEXT = {
  ALREADY_MEMBER: "이미 참여 중인 모임이에요.",
  JOIN_REQUEST_ALREADY_EXISTS: "이미 참여 신청을 했어요. 모임장 승인을 기다려 주세요.",
  GROUP_CLOSED: "모집이 마감된 모임이에요.",
  GROUP_CAPACITY_EXCEEDED: "정원이 가득 찼어요.",
  RESOURCE_VERSION_CONFLICT: "모임 정보가 바뀌었어요. 다시 시도해 주세요.",
  JOIN_REQUEST_NOT_PENDING: "이미 처리된 신청이에요.",
  LEADER_ONLY: "모임장만 할 수 있어요.",
};
export const communityError = (e) => ERROR_TEXT[e.code] || e.message || "요청에 실패했어요.";

export const STATUS = { open: ["모집 중", "open"], full: ["정원 마감", "closed"], closed: ["모집 마감", "closed"], cancelled: ["취소됨", "closed"] };
export const shortId = (id) => (id ? id.replace(/^usr_/, "").slice(0, 6) : "?");

export const SORTS = [
  ["latest", "최신순"],
  ["soon", "일정 가까운 순"],
  ["seats", "남은 자리 많은 순"],
  ["members", "인원 많은 순"],
];
export const FILTERS = [
  ["all", "전체"],
  ["open", "모집 중"],
  ["closed", "마감"],
];

// 표시 형식
export const fmt = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
export const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : "");
const md = (d) => (d ? d.slice(5).replace("-", ".") : "");
// 모임 날짜가 없으면 축제 기간으로 대신 표시 — 단 상시·장기 운영(120일 이상)이면 1년 전체가 찍히므로 「날짜 미정」
const longRun = (f) => f?.start && f?.end && (new Date(f.end) - new Date(f.start)) / 864e5 >= 120;
export const when = (item, f) => (item.date ? md(item.date) : !f ? "-" : longRun(f) ? "날짜 미정" : `${md(f.start)}–${md(f.end || f.start)}`);
export const where = (f) => (f ? [f.region, f.city].filter(Boolean).join(" ") || "지역 미정" : "지역 미정");
export const pct = (item) => Math.min(100, ((item.memberCount || 0) / (item.capacity || 1)) * 100);

// 필터: 전체 / 모집 중 / 마감(모집 중이 아닌 모든 상태)
export const matchesFilter = (x, v) => v === "all" || (v === "open" ? x.status === "open" : x.status !== "open");

// 정렬 기준: 일정 = 모임 날짜(없으면 축제 시작일), 남은 자리 = 정원 − 현재 인원
export function sortFn(sort, festival) {
  const dayOf = (x) => x.date || festival(x.festivalId)?.start || "9999-12-31";
  const seatsOf = (x) => (x.capacity || 0) - (x.memberCount || 0);
  const byLatest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
  const SORT_FN = {
    latest: byLatest,
    soon: (a, b) => dayOf(a).localeCompare(dayOf(b)) || byLatest(a, b),
    seats: (a, b) => seatsOf(b) - seatsOf(a) || byLatest(a, b),
    members: (a, b) => (b.memberCount || 0) - (a.memberCount || 0) || byLatest(a, b),
  };
  return SORT_FN[sort];
}
