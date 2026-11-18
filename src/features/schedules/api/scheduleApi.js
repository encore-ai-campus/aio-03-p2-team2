// 일정 API — 백엔드 기준: app/features/schedules/router.py, app/features/agents/workflow.py
import { apiFetch } from "../../../shared/lib/apiClient.js";
import { resumeAgentRun } from "../../matching/api/agentsApi.js";

const enc = encodeURIComponent;

// GET /groups/{id}/schedule — 현재 확정 일정 { version, current, items[], validation, proposals[] }
export const getSchedule = (groupId) => apiFetch(`/groups/${enc(groupId)}/schedule`);
export const getScheduleDraft = (groupId) => apiFetch(`/groups/${enc(groupId)}/schedule/draft`);

export const discardScheduleProposal = (groupId, proposalId, version) =>
  apiFetch(`/groups/${enc(groupId)}/schedule/proposals/${enc(proposalId)}/reject`, { method: "POST", body: { version } });

// POST /workflow/groups/{id}/schedule — 참여자 가능 시간·기존 조건으로 일정 초안 생성 (모임장만)
// 응답 = 에이전트 실행: status waiting_approval(승인 대기) | waiting_input | failed
//   candidate.items[{date,time,endTime,label,description}], comparison{before,after,attempts}, candidateHistory, trace
export const draftSchedule = (groupId, conditions = {}) =>
  apiFetch(`/workflow/groups/${enc(groupId)}/schedule`, { method: "POST", body: { conditions } });

// 모임장 일정 승인·거절 → 기존 에이전트 resume (최신 checkpointId 필요)
export const decideSchedule = (run, decision) => resumeAgentRun(run.runId, { checkpointId: run.checkpointId, decision });
