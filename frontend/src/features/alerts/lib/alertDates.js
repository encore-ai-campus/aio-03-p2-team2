const WD = ["일", "월", "화", "수", "목", "금", "토"];
export const formatAlertDate = (d) => {
  if (!d) return "";
  const t = new Date(`${d}T00:00:00`);
  return `${t.getMonth() + 1}/${t.getDate()}(${WD[t.getDay()]})`;
};
