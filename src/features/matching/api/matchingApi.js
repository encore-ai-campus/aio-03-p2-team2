// 직접 조건 매칭 API — POST /matching/runs
// 백엔드 기준: app/features/matching/router.py (create_run), schemas.py (MatchingRunRequest)
// 로그인 토큰(JWT)으로 현재 사용자를 판단하므로 /me 없이 호출 가능하다.
import { apiFetch } from "../../../shared/lib/apiClient.js";

// 백엔드 점수 항목 키 → 화면 표시 이름
export const PART_LABEL = {
  schedule: "일정",
  interests: "관심사",
  budget: "예산",
  style: "여행 스타일",
  mbti: "MBTI",
  partySize: "희망 인원",
};

// 화면의 조건(state.profile) → 백엔드 conditions(camelCase)
export function toConditions(profile) {
  return {
    startTime: profile.start || null,
    budgetManwon: profile.budget || null,
    interests: profile.interests || [],
    travelStyle: profile.style || null,
    preferredMbti: profile.mbti || [],
    partySize: profile.party || null,
    joinMode: profile.joinMode || "approval",
  };
}

// 백엔드 후보 → 화면 카드 모델
// parts: { schedule: { score, max, excluded? } } → { 일정: "25/25" | "미선택" } (기존 ScoreWhy와 같은 모양)
export function toCandidateModel(c) {
  const parts = {};
  Object.entries(c.parts || {}).forEach(([key, v]) => {
    parts[PART_LABEL[key] || key] = v.excluded || !v.max ? "미선택" : `${v.score}/${v.max}`;
  });
  return {
    id: c.user.id,
    name: c.user.displayName,
    avatarUrl: c.user.avatarUrl,
    score: c.score,
    parts,
    reasons: c.reasons || [],
  };
}

// POST /matching/runs — 모임 생성 없이 후보만 계산 (모집글 저장은 다음 단계에서 연결)
export async function createMatchingRun({ festivalId, profile, topK = 5 }) {
  const data = await apiFetch("/matching/runs", {
    method: "POST",
    body: { festivalId, conditions: toConditions(profile), createGroup: false, topK },
  });
  return { runId: data.runId, festivalId: data.festivalId, candidates: (data.candidates || []).map(toCandidateModel) };
}
