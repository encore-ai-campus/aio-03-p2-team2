// 악천후 알림·대체 축제 API — 백엔드 기준: app/features/alerts/router.py, app/features/agents/workflow.py
import { apiFetch } from "../../../shared/lib/apiClient.js";

const enc = encodeURIComponent;
const alertChanges = new EventTarget();

export function subscribeToAlertChanges(listener) {
  alertChanges.addEventListener("change", listener);
  return () => alertChanges.removeEventListener("change", listener);
}

function announceNewAlerts(result) {
  if (result?.createdAlertCount > 0) alertChanges.dispatchEvent(new Event("change"));
  return result;
}

// GET /alerts — 내 알림 (최신순) { id, type, festivalId, groupId, title, message, status, choice, isTest, createdAt }
export async function listAlerts() {
  const pageSize = 50;
  const items = new Map();
  let page = 1;
  let total;
  do {
    const result = await apiFetch(`/alerts?pageSize=${pageSize}&page=${page}`);
    for (const item of result.items) if (!items.has(item.id)) items.set(item.id, item);
    if (!result.items.length) break;
    total = result.total;
    page += 1;
  } while ((page - 1) * pageSize < total);
  return [...items.values()];
}

// POST /alerts/{id}/answer — 참여 의사: continue(그대로 참여) | find_alternative(대체 축제) | dismiss
export async function answerAlert(alertId, answer) {
  const result = await apiFetch(`/alerts/${enc(alertId)}/answer`, { method: "POST", body: { answer } });
  alertChanges.dispatchEvent(new Event("change"));
  return result;
}

// PATCH /me/notification-consents — 악천후 알림 수신 동의 (꺼져 있으면 알림이 생성되지 않음)
export const enableRiskAlert = () => apiFetch("/me/notification-consents", { method: "PATCH", body: { riskAlert: true } });
// 악천후 알림 켜기/끄기 (GET /me 의 notificationConsent.riskAlert 와 같은 값)
export const setRiskAlert = (on) => apiFetch("/me/notification-consents", { method: "PATCH", body: { riskAlert: !!on } });

// POST /workflow/groups/{id}/weather-check — 모임 일정 날짜의 날씨 확인 (모임장만)
// simulateRisk: true 면 개발 환경에서 시험용 악천후 알림 생성 (제목 [테스트], isTest=true)
// 응답 { groupId, date, risk, createdAlertCount, isTest, nextAction }
export const weatherCheck = (groupId, simulateRisk = false) =>
  apiFetch(`/workflow/groups/${enc(groupId)}/weather-check`, { method: "POST", body: { simulateRisk } }).then(announceNewAlerts);

// 대체 축제 추천 (모임장만) — 알림에서 시작하거나, 알림 없이 모임에서 바로 시작
// 응답 = 에이전트 실행: status completed → candidate.items(대체 축제 목록)
export const riskResponseFromAlert = (alertId) => apiFetch(`/alerts/${enc(alertId)}/risk-response`, { method: "POST" });
export const riskResponseForGroup = (groupId) => apiFetch(`/workflow/groups/${enc(groupId)}/risk-response`, { method: "POST" });

// POST /workflow/risk-runs/{runId}/select — 추천받은 대체 축제 선택 → 그 축제 기준 일정 재생성 실행
// 응답 = 에이전트 실행: waiting_approval → comparison.before(기존)·after(새 일정) → 모임장 확정(resume decision)
// 날짜를 생략하면 서버가 추천 실행에 저장된 모임 날짜를 유지한다.
export const selectAlternative = (runId, festivalId) =>
  apiFetch(`/workflow/risk-runs/${enc(runId)}/select`, { method: "POST", body: { festivalId } });

// POST /workflow/groups/{id}/weather-review — 날씨 확인 + 「그래도 진행할까요?」 (모임장만)
// 응답 { weatherCheck: { date, risk, weather, createdAlertCount, isTest }, run: 에이전트 실행 }
// 비 예보면 run.status = waiting_input, run.interrupt.type = "weather_confirmation"
//   → resumeAgentRun(runId, { checkpointId, weatherDecision: "keep" | "alternatives" })
//   keep = 기존 축제 유지(완료) / alternatives = 대체 축제 추천 결과(candidate.items)로 완료 → selectAlternative 흐름
// 비 예보가 없으면 질문 없이 바로 completed(keep)
export async function weatherReview(groupId, simulateRisk = false) {
  const result = await apiFetch(`/workflow/groups/${enc(groupId)}/weather-review`, { method: "POST", body: { simulateRisk } });
  announceNewAlerts(result.weatherCheck);
  return result;
}
