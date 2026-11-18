const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => iso(new Date());

export const formatMatchingDate = (s, separator = "/") => {
  const d = new Date(s + "T00:00:00");
  return `${d.getMonth() + 1}${separator}${d.getDate()}(${"일월화수목금토"[d.getDay()]})`;
};

// 축제 기간 중 오늘 이후 날짜 (최대 7일) → 날짜 선택 칩
export function festivalDates(f) {
  if (!f?.start) return [];
  const today = todayIso();
  const out = [];
  const d = new Date((f.start > today ? f.start : today) + "T00:00:00");
  while (out.length < 7 && iso(d) <= (f.end || f.start)) {
    out.push(iso(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// 자유 입력에서 날짜 찾기: 2026-11-17 · 11월 17일 · 17일 · 오늘 · 내일 · 모레
export function parseDate(text) {
  const now = new Date();
  const m1 = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return `${m1[1]}-${pad(m1[2])}-${pad(m1[3])}`;
  const m2 = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m2) return `${now.getFullYear()}-${pad(m2[1])}-${pad(m2[2])}`;
  const rel = { 오늘: 0, 내일: 1, 모레: 2 };
  for (const [k, v] of Object.entries(rel))
    if (text.includes(k)) {
      const d = new Date(now);
      d.setDate(d.getDate() + v);
      return iso(d);
    }
  const m3 = text.match(/(\d{1,2})\s*일/);
  if (m3) return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(m3[1])}`;
  return null;
}
