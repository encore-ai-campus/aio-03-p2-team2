// 실제 데이터 여부는 ID 형식이 아니라 API에서 받은 목록으로 확인한다.
export const selectedApiFestival = (festivals, id) => festivals.find((f) => f.id === id);

export function matchingAgentRequest({ festivals, festivalId, selectedDate, message, sessionId }) {
  const selected = selectedApiFestival(festivals, festivalId);
  return {
    message,
    sessionId,
    festivalId: selected?.id,
    conditions: selected && selectedDate >= selected.start && selectedDate <= selected.end
      ? { date: selectedDate }
      : {},
  };
}

export function matchingView(source) {
  if (source === "api") return "api";
  if (source === "loading") return "loading";
  return source === "empty" ? "empty" : "error";
}
