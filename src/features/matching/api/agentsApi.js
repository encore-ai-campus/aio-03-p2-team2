// AI 매칭 챗봇(LangGraph 에이전트) API — /agents/runs
// 백엔드 기준: app/features/agents/router.py, schemas.py (RunStart, ResumeRun), service.py (get 응답)
// 응답 status: running | waiting_input(추가 질문) | waiting_approval(승인 대기) | completed 등
// 응답 주요 필드: runId, sessionId, status, checkpointId, conditions, candidate, result, errors, interrupt, trace
import { apiFetch } from "../../../shared/lib/apiClient.js";

// 새 실행 — message: 사용자가 챗봇에 적은 문장
export const startAgentRun = ({ message, festivalId, sessionId, conditions = {} }) =>
  apiFetch("/agents/runs", {
    method: "POST",
    body: { message, intent: "matching", festivalId, sessionId, conditions },
  });

export const getAgentRun = (runId) => apiFetch(`/agents/runs/${encodeURIComponent(runId)}`);

// 추가 질문에 답하기(answers · festivalId · groupId) 또는 승인 처리(decision: approve | reject | cancel)
// checkpointId는 직전 응답의 값을 그대로 보내야 한다 (다르면 409 CHECKPOINT_STALE)
export const resumeAgentRun = (runId, { checkpointId, message, answers, decision, festivalId, groupId }) =>
  apiFetch(`/agents/runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
    body: { checkpointId, message, answers, decision, festivalId, groupId },
  });
