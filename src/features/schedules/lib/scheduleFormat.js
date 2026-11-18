// 공동 일정 — 오류 문구·수정 전략 이름·진행 단계·날짜 표시·변경 비교 키

const ERROR_TEXT = {
  LEADER_ONLY: "모임장만 일정을 만들 수 있어요.",
  CHECKPOINT_STALE: "일정 상태가 바뀌었어요. 초안을 다시 만들어 주세요.",
  RUN_NOT_WAITING: "이미 처리된 초안이에요.",
  GROUP_MEMBER_ONLY: "모임 참여자만 일정을 볼 수 있어요.",
};
export const scheduleError = (e) => ERROR_TEXT[e.code] || e.message || "요청에 실패했어요.";
export const REPAIR_KO = { regenerate: "조건을 반영해 다시 생성", refresh_tools: "최신 정보로 다시 조회", ask_user: "사용자에게 추가 확인", stop: "중단" };
export const STEPS = ["참여 확정", "AI 초안", "검증·수정", "모임장 확정"];
const WD = ["일", "월", "화", "수", "목", "금", "토"];
export const dayLabel = (d) => {
  if (!d) return "";
  const t = new Date(`${d}T00:00:00`);
  return `${t.getMonth() + 1}/${t.getDate()}(${WD[t.getDay()]})`;
};

// 기존 일정의 (활동|시각) 묶음 — 새 초안에서 이 묶음에 없는 항목은 바뀐 것으로 표시
export const keysOf = (items) => new Set((items || []).map((x) => `${x.label}|${x.time}`));
export const isChanged = (x, changedKeys) => !!changedKeys?.size && !changedKeys.has(`${x.label}|${x.time}`);
