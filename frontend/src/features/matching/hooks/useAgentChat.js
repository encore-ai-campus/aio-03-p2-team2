import { useEffect, useState } from "react";
import { resumeAgentRun, startAgentRun } from "../api/agentsApi.js";
import { toCandidateModel } from "../api/matchingApi.js";
import { matchingAgentRequest, selectedApiFestival } from "../lib/agentFestival.js";
import { firstMissing, parseTime, pickableFestivals } from "../lib/agentChatInputs.js";
import { formatMatchingDate, parseDate } from "../lib/matchingDates.js";

const ERROR_TEXT = {
  CHECKPOINT_STALE: "대화 상태가 바뀌었어요. ‘새 대화’로 다시 시작해 주세요.",
  RUN_NOT_WAITING: "이미 끝난 대화예요. 새로 요청해 주세요.",
  AUTH_USER_INVALID: "로그인 계정을 확인할 수 없어요. 다시 로그인해 주세요.",
  AUTH_USER_NOT_LINKED: "로그인 계정이 앱 사용자와 연결되지 않았어요. 다시 로그인해 주세요.",
};

export function useAgentChat({ festivals, festivalId, selectedDate, onPickFestival, onResult, onStage }) {
  const [messages, setMessages] = useState([]);
  const [run, setRun] = useState(null); // 마지막 에이전트 응답
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [festQuery, setFestQuery] = useState(""); // 축제 고르기 검색어
  const festival = (id) => festivals.find((f) => f.id === id);

  // 오른쪽 STEP 안내와 연결: 0 조건 말하기 · 1 빠진 조건 되묻기 · 2 동행 추천
  useEffect(() => {
    const stage = run?.status === "waiting_input" ? 1 : run?.status === "completed" ? 2 : 0;
    onStage?.(stage);
  }, [run, onStage]);

  const push = (m) => setMessages((list) => [...list, m]);

  // 에이전트 응답 → 화면 메시지
  function handle(res) {
    setRun(res);
    if (res.status === "waiting_input") {
      push({
        role: "bot",
        type: "ask",
        missing: res.interrupt?.missing || [],
        question: res.interrupt?.message, // 백엔드가 만든 질문 (예: "몇 시에 참여하실 건가요?")
        errors: res.interrupt?.errors || [],
        run: res,
      });
    } else if (res.status === "completed") {
      const items = (res.candidate?.items || res.result?.items || []).map(toCandidateModel);
      push({ role: "bot", type: "result", items, run: res });
      // 오른쪽 「추천 동행 후보」 패널에도 같은 결과 표시
      // 챗봇에서 받은 조건(날짜·시작 시간 등)도 함께 넘겨 모집글·조건 요약에 쓴다 (snake_case/camelCase 모두 대응)
      const c = res.conditions || {};
      const conditions = {
        date: c.date,
        startTime: c.start_time ?? c.startTime,
        partySize: c.party_size ?? c.partySize,
        budgetManwon: c.budget_manwon ?? c.budgetManwon,
        interests: c.interests,
        travelStyle: c.travel_style ?? c.travelStyle,
      };
      onResult?.({ status: "done", key: "agent", runId: res.runId, partySize: conditions.partySize, conditions, result: { candidates: items }, error: null });
    } else if (res.status === "failed" || res.status === "cancelled") {
      const reason = res.errors?.[0]?.message || res.result?.summary || "요청을 완료하지 못했어요.";
      push({ role: "bot", type: "text", text: `😥 ${reason}\n조건을 바꿔서 다시 말해 주세요.`, run: res });
    } else {
      push({ role: "bot", type: "text", text: `처리 상태: ${res.status}`, run: res });
    }
  }

  async function call(fn, userText) {
    if (busy) return;
    if (userText) push({ role: "user", text: userText });
    setBusy(true);
    try {
      handle(await fn());
    } catch (error) {
      console.warn("[agent] API 실패", error);
      push({ role: "bot", type: "text", text: `⚠️ ${ERROR_TEXT[error.code] || error.message || "에이전트 호출에 실패했어요."}` });
      if (error.code === "CHECKPOINT_STALE" || error.code === "RUN_NOT_WAITING") setRun(null);
    } finally {
      setBusy(false);
    }
  }

  const waiting = run?.status === "waiting_input";

  // 새 요청 또는 되묻기에 대한 답변
  function send(raw) {
    const value = String(raw || "").trim();
    if (!value || busy) return;
    setText("");
    if (waiting && firstMissing(run.interrupt?.missing) === "festivalId") {
      // 축제를 묻는 중: 적은 이름과 맞는 축제가 하나면 바로 답하고, 아니면 목록 검색어로 쓴다
      const v = value.toLowerCase().replace(/\s/g, "");
      const hits = pickableFestivals(festivals, "").filter((f) => {
        const n = f.name.toLowerCase().replace(/\s/g, "");
        return n.includes(v) || (v.length >= 2 && v.includes(n));
      });
      if (hits.length === 1) return answerFestival(hits[0].id);
      setFestQuery(value);
      return;
    }
    if (waiting) {
      const date = parseDate(value);
      const startTime = parseTime(value);
      const answers = { ...(date && { date }), ...(startTime && { startTime }) };
      return call(
        () =>
          resumeAgentRun(run.runId, {
            checkpointId: run.checkpointId,
            message: value,
            answers: Object.keys(answers).length ? answers : undefined,
          }),
        value,
      );
    }
    return call(
      () => startAgentRun(matchingAgentRequest({ festivals, festivalId, selectedDate,
        message: value, sessionId: run?.sessionId })),
      value,
    );
  }

  const answerDate = (date) =>
    call(() => resumeAgentRun(run.runId, { checkpointId: run.checkpointId, answers: { date } }), formatMatchingDate(date));

  const answerTime = ([label, startTime]) =>
    call(() => resumeAgentRun(run.runId, { checkpointId: run.checkpointId, answers: { startTime } }), label + "부터 가능해요");

  const answerFestival = (id) => {
    if (!selectedApiFestival(festivals, id)) {
      push({ role: "bot", type: "text", text: "실제 축제 목록에서 참여할 축제를 선택해 주세요." });
      return;
    }
    setFestQuery("");
    onPickFestival?.(id);
    call(() => resumeAgentRun(run.runId, { checkpointId: run.checkpointId, festivalId: id }), festival(id)?.name || id);
  };

  function reset() {
    if (busy) return;
    setMessages([]);
    setRun(null);
    setFestQuery("");
    onResult?.(null);
  }

  return {
    messages, run, busy, waiting, text, setText, festQuery, setFestQuery,
    send, answerDate, answerTime, answerFestival, reset,
  };
}
