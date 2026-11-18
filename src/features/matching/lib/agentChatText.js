// 동행 찾기 챗봇 — 예시 문장·시간 칩·되묻기 문구·확인한 조건 한 줄·입력창 안내 문구
import { firstMissing } from "./agentChatInputs.js";
import { formatMatchingDate } from "./matchingDates.js";

// 시간을 일부러 빼 둔 예시 → 에이전트가 "몇 시에 참여하실 건가요?"를 되묻는 장면을 보여줄 수 있다
// 첫 예시는 선택한 축제 이름을 넣는다 (선택 전이면 축제를 되묻는다)
export const examplesFor = (f) => [
  // 축제 미선택 예시에 「축제」를 넣지 않음 — 백엔드가 축제 태그 「축제」를 관심사로 해석해 점수가 깎임(A-6)
  f ? `${f.name} 같이 갈 동행 찾아줘` : "같이 갈 동행 찾아줘",
  "2명이서 여유롭게 둘러볼 동행 찾아줘",
  "예산 5만원, 사진·미식 좋아하는 사람이랑 가고 싶어",
];

export const TIME_CHIPS = [["오전 11시", "11:00"], ["오후 1시", "13:00"], ["오후 3시", "15:00"], ["저녁 6시", "18:00"]];
export const ASK_TEXT = {
  festivalId: "어떤 축제에 함께 갈까요? 아래에서 고르거나 축제 이름을 적어 주세요.",
  date: "어느 날짜에 참여하실 건가요?",
  startTime: "몇 시부터 합류할 수 있나요?",
};
export const shortDate = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
export const FEST_SHOW = 5;

// 마지막 매칭 결과의 조건 → 「확인한 조건」 한 줄 (축제는 위 축제 카드에 이미 있으므로 조건만)
export function confirmedConditions(messages) {
  const lastResult = [...messages].reverse().find((m) => m.type === "result");
  if (!lastResult) return "";
  const raw = lastResult.run.conditions || {};
  const d = raw.date;
  const t = raw.start_time ?? raw.startTime;
  const p = raw.party_size ?? raw.partySize;
  const b = raw.budget_manwon ?? raw.budgetManwon;
  return [
    d && formatMatchingDate(d),
    t && t + " 시작",
    p && p + "명",
    b && b + "만원",
    raw.interests?.length && raw.interests.join("·"),
  ]
    .filter(Boolean)
    .join(" · ");
}

// 입력창 안내: 대기 중이면 지금 되묻는 항목에 맞춘 예시
export function inputPlaceholder(waiting, run) {
  if (!waiting) return "예) 2명이서 여유롭게 둘러볼 동행 찾아줘";
  const ask = firstMissing(run.interrupt?.missing);
  if (ask === "festivalId") return "축제 이름을 적어 주세요 (예: 드론 라이트쇼)";
  if (ask === "date") return "날짜를 적어 주세요 (예: 11월 20일)";
  return "시간을 적어 주세요 (예: 오후 3시부터)";
}
