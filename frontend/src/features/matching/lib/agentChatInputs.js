import { todayIso } from "./matchingDates.js";

// 자유 입력에서 시각 찾기: 15:00 · 오후 3시 · 3시 반 · 저녁 6시
export function parseTime(text) {
  const pad = (value) => String(value).padStart(2, "0");
  const m1 = text.match(/(\d{1,2}):(\d{2})/);
  if (m1) return `${pad(m1[1])}:${m1[2]}`;
  const m2 = text.match(/(오전|오후|저녁|밤|낮)?\s*(\d{1,2})\s*시\s*(반|(\d{1,2})\s*분)?/);
  if (!m2) return null;
  let h = Number(m2[2]);
  if (["오후", "저녁", "밤"].includes(m2[1]) && h < 12) h += 12;
  const min = m2[3] === "반" ? 30 : Number(m2[4] || 0);
  return h > 23 ? null : `${pad(h)}:${pad(min)}`;
}

const ASK_ORDER = ["festivalId", "date", "startTime"];
export const firstMissing = (missing = []) => ASK_ORDER.find((k) => missing.includes(k));

// 축제 고르기 목록: 지난 축제 제외 → 기간 한정(120일 미만) 먼저, 시작일 순 → 상시·장기 운영 (축제 탐색과 같은 기준)
const spanDays = (f) => (new Date(f.end + "T00:00:00") - new Date(f.start + "T00:00:00")) / 864e5;
export const isLongRun = (f) => spanDays(f) >= 120;
export function pickableFestivals(list, query) {
  const today = todayIso();
  const q = query.trim().toLowerCase();
  return list
    .filter((f) => f.start && (f.end || f.start) >= today)
    .filter((f) => !q || `${f.name} ${f.region} ${f.city}`.toLowerCase().includes(q))
    .sort((a, b) => isLongRun(a) - isLongRun(b) || a.start.localeCompare(b.start));
}
