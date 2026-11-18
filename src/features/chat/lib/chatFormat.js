// 모임 채팅방 — 오류 문구·날짜 표시·연결 상태 문구·메시지 병합

export const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const ERROR_TEXT = {
  CHAT_MEMBER_ONLY: "모임 참여자만 채팅을 이용할 수 있어요.",
  GROUP_NOT_FOUND: "모임을 찾을 수 없어요.",
};
export const chatError = (e) => ERROR_TEXT[e?.code] || e?.message || "요청에 실패했어요.";
export const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2)}`);
export const dayLabel = (s) => {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(+d) ? s : `${d.getMonth() + 1}.${d.getDate()}(${WEEK[d.getDay()]})`;
};
export const LIVE_TEXT = { live: "실시간 연결됨", polling: "실시간 끊김 · 5초마다 갱신", connecting: "연결 중…", unavailable: "채팅을 이용할 수 없음" };

// DB의 (생성 시각, ID) 정렬과 맞춘다. Date는 밀리초 아래의 정밀도를 버린다.
const fractionalSecond = (value) => Number(value?.match(/\.\d+/)?.[0] || 0);
function compareMessages(a, b) {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt)
    || fractionalSecond(a.createdAt) - fractionalSecond(b.createdAt)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const mergeMsgs = (prev, items) => {
  const map = new Map((prev || []).map((m) => [m.id, m]));
  items.forEach((m) => m && map.set(m.id, m));
  return [...map.values()].sort(compareMessages);
};
