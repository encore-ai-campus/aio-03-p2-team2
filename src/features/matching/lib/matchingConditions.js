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
