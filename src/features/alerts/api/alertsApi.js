// 악천후 알림·대체 축제 API — 백엔드 기준: app/features/alerts/router.py, app/features/agents/workflow.py
import { apiFetch } from "../../../shared/lib/apiClient.js";

const enc = encodeURIComponent;

// GET /alerts — 내 알림 (최신순) { id, type, festivalId, groupId, title, message, status, choice, isTest, createdAt }
export const listAlerts = () => apiFetch("/alerts?pageSize=50").then((d) => d.items);

// GET /alerts?page&pageSize[&status=unread] — 알림 드롭다운용 페이지 조회 { items, page, pageSize, total }
export const listAlertsPage = ({ page = 1, pageSize = 10, status } = {}) =>
  apiFetch(`/alerts?page=${page}&pageSize=${pageSize}${status ? `&status=${enc(status)}` : ""}`).then((d) => ({
    items: d?.items || [],
    total: typeof d?.total === "number" ? d.total : null,
  }));

// PATCH /alerts/{id}/read — 단건 읽음 처리 (unread 항목에만 호출: answered·dismissed를 read로 덮어쓰지 않도록)
export const markAlertRead = (alertId) => apiFetch(`/alerts/${enc(alertId)}/read`, { method: "PATCH" });

// POST /alerts/{id}/answer — 참여 의사: continue(그대로 참여) | find_alternative(대체 축제) | dismiss
export const answerAlert = (alertId, answer) => apiFetch(`/alerts/${enc(alertId)}/answer`, { method: "POST", body: { answer } });

// PATCH /me/notification-consents — 악천후 알림 수신 동의 (꺼져 있으면 알림이 생성되지 않음)
export const enableRiskAlert = () => apiFetch("/me/notification-consents", { method: "PATCH", body: { riskAlert: true } });
// 악천후 알림 켜기/끄기 (GET /me 의 notificationConsent.riskAlert 와 같은 값)
export const setRiskAlert = (on) => apiFetch("/me/notification-consents", { method: "PATCH", body: { riskAlert: !!on } });

// POST /workflow/groups/{id}/weather-check — 모임 일정 날짜의 날씨 확인 (모임장만)
// simulateRisk: true 면 개발 환경에서 시험용 악천후 알림 생성 (제목 [테스트], isTest=true)
// 응답 { groupId, date, risk, createdAlertCount, isTest, nextAction }
export const weatherCheck = (groupId, simulateRisk = false) =>
  apiFetch(`/workflow/groups/${enc(groupId)}/weather-check`, { method: "POST", body: { simulateRisk } });

// 대체 축제 추천 (모임장만) — 알림에서 시작하거나, 알림 없이 모임에서 바로 시작
// 응답 = 에이전트 실행: status completed → candidate.items(대체 축제 목록)
export const riskResponseFromAlert = (alertId) => apiFetch(`/alerts/${enc(alertId)}/risk-response`, { method: "POST" });
export const riskResponseForGroup = (groupId) => apiFetch(`/workflow/groups/${enc(groupId)}/risk-response`, { method: "POST" });

// POST /workflow/risk-runs/{runId}/select — 추천받은 대체 축제 선택 → 그 축제 기준 일정 재생성 실행
// 응답 = 에이전트 실행: waiting_approval → comparison.before(기존)·after(새 일정) → 모임장 확정(resume decision)
// ⚠️ 날짜는 자동으로 바뀌지 않음 — 대체 축제 기간 안의 날짜를 conditions.date로 꼭 보내야 함
//    (안 보내면 기존 일정 날짜로 검증해서 FESTIVAL_UNAVAILABLE "축제 기간 또는 취소 상태를 확인해야 합니다")
export const selectAlternative = (runId, festivalId, date) =>
  apiFetch(`/workflow/risk-runs/${enc(runId)}/select`, { method: "POST", body: { festivalId, conditions: date ? { date } : {} } });

// POST /workflow/groups/{id}/weather-review — 날씨 확인 + 「그래도 진행할까요?」 (모임장만)
// 응답 { weatherCheck: { date, risk, weather, createdAlertCount, isTest }, run: 에이전트 실행 }
// 비 예보면 run.status = waiting_input, run.interrupt.type = "weather_confirmation"
//   → resumeAgentRun(runId, { checkpointId, weatherDecision: "keep" | "alternatives" })
//   keep = 기존 축제 유지(완료) / alternatives = 대체 축제 추천 결과(candidate.items)로 완료 → selectAlternative 흐름
// 비 예보가 없으면 질문 없이 바로 completed(keep)
export const weatherReview = (groupId, simulateRisk = false) =>
  apiFetch(`/workflow/groups/${enc(groupId)}/weather-review`, { method: "POST", body: { simulateRisk } });
