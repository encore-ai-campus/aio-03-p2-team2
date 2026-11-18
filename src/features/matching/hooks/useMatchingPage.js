import { useEffect, useRef, useState } from "react";
import { useAppState } from "../../../app/AppStateProvider.jsx";
import { useMe } from "../../auth/hooks/useMe.js";
import { useFestivals } from "../../festivals/hooks/useFestivals.js";
import { matchingView, selectedApiFestival } from "../lib/agentFestival.js";
import { AI_JOIN, recruitmentJoinMode } from "../lib/matchingConditions.js";
import { formatMatchingDate } from "../lib/matchingDates.js";
import { conditionKey, useMatchingRun } from "./useMatchingRun.js";

export function useMatchingPage() {
  const { state, active, dateShort, dispatch, fieldProps, mutate } = useAppState();
  const profile = state.profile;
  // 축제 탐색과 동일한 실제 API 목록만 사용한다.
  const { festivals: liveFestivals, source } = useFestivals();
  const useApi = source === "api";
  const findFestival = (id) => selectedApiFestival(liveFestivals, id);
  const isOpen = (x) => (x.apiStatus ? x.apiStatus !== "past" && x.riskStatus !== "cancelled" : active(x));
  const festivals = liveFestivals.filter(isOpen);
  const apiFestival = useApi ? selectedApiFestival(festivals, state.festivalId) : undefined;
  useEffect(() => {
    if (!useApi || !state.festivalId || apiFestival) return;
    mutate((s) => {
      s.festivalId = null;
    });
  }, [useApi, state.festivalId, apiFestival, mutate]);
  // 직접 조건 매칭(실제 API) — 조건이 바뀌면 이전 결과는 숨긴다
  const { run, execute } = useMatchingRun();
  const [formMessage, setFormMessage] = useState("");
  // 오른쪽 패널 결과: 챗봇(에이전트) 결과가 있으면 우선, 없으면 직접 조건 매칭 결과
  const [agentRun, setAgentRun] = useState(null);
  const directResult = useApi && run.key === conditionKey(state.festivalId, profile) ? run : null;
  const apiResult = useApi ? agentRun || directResult : null;
  const runApiMatch = () => {
    const missing = [
      !festivals.some((x) => x.id === state.festivalId) && "축제",
      !profile.date && "참여 날짜",
      !profile.start && "시작 시간",
      !profile.party && "희망 인원",
    ].filter(Boolean);
    if (missing.length) return setFormMessage(`필수 조건을 입력해 주세요: ${missing.join(", ")}`);
    const selected = findFestival(state.festivalId);
    if (profile.date < selected.start || profile.date > selected.end) return setFormMessage("참여 날짜는 축제 운영 기간 안에서 선택해 주세요.");
    setFormMessage("");
    setAgentRun(null);
    execute(state.festivalId, profile);
  };
  const chosen = state.festivalId ? findFestival(state.festivalId) : null;
  const summaryItems = [
    chosen?.name,
    profile.date && formatMatchingDate(profile.date),
    profile.start && profile.start + " 시작",
    profile.party && profile.party + "명",
    profile.budget && profile.budget + "만원",
    profile.interests.length && profile.interests.join("·"),
    profile.style,
    profile.mbti.length && "MBTI " + profile.mbti.join("/"),
  ].filter(Boolean);
  const summary = summaryItems.length
    ? [...summaryItems, AI_JOIN[profile.joinMode]].join(" · ")
    : "아직 설정한 조건이 없어요 · 챗봇에 말하거나 여기서 직접 설정하세요";

  // 챗봇(에이전트) 매칭 결과가 있으면 챗봇에서 받은 조건으로 요약한다
  const ac = agentRun?.conditions;
  const agentBits = ac
    ? [
        ac.date && formatMatchingDate(ac.date),
        ac.startTime && ac.startTime + " 시작",
        ac.partySize && ac.partySize + "명",
      ].filter(Boolean)
    : [];
  // 모집글 본문은 바로 위 줄에 축제명이 있으므로 축제명 없이
  const postSummary = agentBits.length ? [...agentBits, AI_JOIN[recruitmentJoinMode(agentRun, profile.joinMode)]].filter(Boolean).join(" · ") : summary;

  // ① 온보딩에서 고른 내 선호(관심사·스타일·예산·인원·합류 시각·입장 방식)를 빈 칸에 한 번 채운다
  const me = useMe();
  const prefilled = useRef(false);
  useEffect(() => {
    if (!useApi || !me?.profile || prefilled.current) return;
    prefilled.current = true;
    const p = me.profile;
    mutate((s) => {
      const t = s.profile;
      if (!t.interests?.length && p.interests?.length) t.interests = [...p.interests];
      if (!t.style && p.travelStyle) t.style = p.travelStyle;
      if (!t.budget && p.budgetManwon) t.budget = String(p.budgetManwon);
      if (!t.party && p.preferredPartySize) t.party = String(p.preferredPartySize);
      if (!t.start && p.availableFrom) t.start = String(p.availableFrom).slice(0, 5);
      if (p.defaultJoinMode) t.joinMode = p.defaultJoinMode;
    });
  }, [useApi, me, mutate]);

  // ② 챗봇(에이전트)이 확정한 조건은 폼에 덮어써서 바로 수정할 수 있게 한다
  const agentCond = agentRun?.conditions;
  useEffect(() => {
    if (!agentCond) return;
    mutate((s) => {
      const t = s.profile;
      if (agentCond.date) t.date = agentCond.date;
      if (agentCond.startTime) t.start = String(agentCond.startTime).slice(0, 5);
      if (agentCond.partySize) t.party = String(agentCond.partySize);
      if (agentCond.budgetManwon) t.budget = String(agentCond.budgetManwon);
      if (agentCond.interests?.length) t.interests = [...agentCond.interests];
      if (agentCond.travelStyle) t.style = agentCond.travelStyle;
    });
  }, [agentCond, mutate]);

  function pickFestival(id) {
    mutate((next) => {
      next.festivalId = id;
    });
  }

  function setProfileField(field, value) {
    mutate((next) => {
      next.profile[field] = value;
    });
  }

  function toggleStyle(style) {
    mutate((next) => {
      next.profile.style = next.profile.style === style ? "" : style;
    });
  }

  function changeBudget(input) {
    const digits = input.replace(/[^0-9]/g, "");
    const budget = digits === "" ? "" : String(Math.min(100, Math.max(1, Number(digits))));
    setProfileField("budget", budget);
  }

  const form = {
    formatFestivalDate: dateShort,
    fields: {
      festival: fieldProps("match-festival"),
      start: fieldProps("match-start"),
      party: fieldProps("match-cap"),
    },
    changeDate: (date) => setProfileField("date", date),
    changeJoinMode: (mode) => setProfileField("joinMode", mode),
    changeBudget,
    toggleStyle,
    toggleInterest: (interest) => dispatch(`interest:${interest}`),
    toggleMbti: (mbti) => dispatch(`mbti:${mbti}`),
  };

  return {
    view: matchingView(source),
    festivals,
    festivalId: apiFestival?.id,
    chosen,
    selectedDate: chosen && profile.date >= chosen.start && profile.date <= chosen.end ? profile.date : undefined,
    profile,
    form,
    formMessage,
    submitting: run.status === "loading",
    result: apiResult,
    postSummary,
    joinLabel: AI_JOIN[recruitmentJoinMode(agentRun, profile.joinMode)],
    runApiMatch, setAgentRun, pickFestival,
  };
}
