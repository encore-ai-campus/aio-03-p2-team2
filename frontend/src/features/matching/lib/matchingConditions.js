export const AI_JOIN = { approval: "모임장 승인제", instant: "즉시 참여제" };

export function toConditions(profile) {
  return {
    date: profile.date || null,
    startTime: profile.start || null,
    budgetManwon: profile.budget || null,
    interests: profile.interests || [],
    travelStyle: profile.style || null,
    preferredMbti: profile.mbti || [],
    partySize: profile.party || null,
    joinMode: profile.joinMode || "approval",
  };
}


export const recruitmentJoinMode = (agentRun, selectedMode) => agentRun ? "approval" : selectedMode || "approval";
