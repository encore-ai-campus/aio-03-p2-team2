const WD = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n) => String(n).padStart(2, "0");
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const formatAlertDate = (d) => {
  if (!d) return "";
  const t = new Date(`${d}T00:00:00`);
  return `${t.getMonth() + 1}/${t.getDate()}(${WD[t.getDay()]})`;
};
// 대체 축제 기간 안에서 오늘 이후 첫날 (지난 기간이면 시작일)
export const alternativeDate = (f) => (f.startDate >= todayIso() ? f.startDate : todayIso() <= f.endDate ? todayIso() : f.startDate);
