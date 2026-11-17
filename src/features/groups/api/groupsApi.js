// 모임·커뮤니티 API — 백엔드 기준: app/features/groups/router.py, schemas.py
import { apiFetch } from "../../../shared/lib/apiClient.js";

const enc = encodeURIComponent;

// GET /groups — 목록 (members·joinRequests는 빠진 요약본)
export const listGroups = () => apiFetch("/groups?pageSize=100").then((d) => d.items);

// GET /groups/{id} — 상세 (members·comments·version 포함, joinRequests는 빠짐)
export const getGroup = (id) => apiFetch(`/groups/${enc(id)}`);

// POST /groups — 모집글(모임) 생성. 만든 사람이 모임장
// title 1~45자, postBody 1~2000자, capacity 2~8, joinMode approval|instant
export const createGroup = ({ festivalId, title, postBody, capacity, joinMode }) =>
  apiFetch("/groups", { method: "POST", body: { festivalId, title, postBody, capacity, joinMode } });

// GET /groups/{id}/join-requests — 모임장만 (아니면 403 LEADER_ONLY)
export const listJoinRequests = (id, status = "pending") =>
  apiFetch(`/groups/${enc(id)}/join-requests?status=${status}&pageSize=100`).then((d) => d.items);

// POST /workflow/matching/{runId}/group — 에이전트 매칭 결과로 모집글 생성 (축제·날짜·시간·선호 조건을 이어받음, 승인제)
// 같은 매칭 실행으로 다시 요청하면 같은 모임을 돌려준다
export const createGroupFromRun = (runId, { title, postBody, capacity }) =>
  apiFetch(`/workflow/matching/${enc(runId)}/group`, { method: "POST", body: { title, postBody, capacity } }).then((d) => d.group);

// POST /groups/{id}/join-requests — 승인제면 신청 생성, 즉시 참여제면 바로 멤버
export const requestJoin = (id, message) =>
  apiFetch(`/groups/${enc(id)}/join-requests`, { method: "POST", body: { message: message || null } });

// 모임장 승인·거절 — version은 상세 응답의 group.version (다르면 409 RESOURCE_VERSION_CONFLICT)
export const approveJoin = (id, requestId, version) =>
  apiFetch(`/groups/${enc(id)}/join-requests/${enc(requestId)}/approve`, { method: "POST", body: { version } });
export const rejectJoin = (id, requestId, version, reason) =>
  apiFetch(`/groups/${enc(id)}/join-requests/${enc(requestId)}/reject`, { method: "POST", body: { version, reason: reason || null } });

// 공개 댓글
export const addComment = (id, text) => apiFetch(`/groups/${enc(id)}/comments`, { method: "POST", body: { text } });
