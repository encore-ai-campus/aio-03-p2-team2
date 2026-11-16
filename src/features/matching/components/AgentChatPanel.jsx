// AI 매칭 도우미 — 실제 LangGraph 에이전트(/agents/runs) 연결 버전
// 흐름: 문장 전송 → POST /agents/runs (intent: matching)
//   → status "waiting_input": 빠진 조건(interrupt.missing)을 되묻고 → 답변을 POST /resume 로 전송 (반복)
//   → status "completed": result.items(추천 후보) 표시
//   → status "failed": 오류·수정 전략(repair) 사유 표시
// 서버 연결이 안 되면 MatchingPage가 기존 데모 챗봇(AiChatPanel)을 대신 보여준다.
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/components/Primitives.jsx";
import { resumeAgentRun, startAgentRun } from "../api/agentsApi.js";
import { toCandidateModel } from "../api/matchingApi.js";

// 시간을 일부러 빼 둔 예시 → 에이전트가 "몇 시에 참여하실 건가요?"를 되묻는 장면을 보여줄 수 있다
// 첫 예시는 선택한 축제 이름을 넣는다 (선택 전이면 축제를 되묻는다)
const examplesFor = (f) => [
  f ? `${f.name} 같이 갈 동행 찾아줘` : "축제 같이 갈 동행 찾아줘",
  "2명이서 여유롭게 둘러볼 동행 찾아줘",
  "예산 5만원, 사진·미식 좋아하는 사람이랑 가고 싶어",
];

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayLabel = (s) => {
  const d = new Date(s + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}(${"일월화수목금토"[d.getDay()]})`;
};

// 축제 기간 중 오늘 이후 날짜 (최대 7일) → 날짜 선택 칩
function festivalDates(f) {
  if (!f?.start) return [];
  const today = iso(new Date());
  const out = [];
  const d = new Date((f.start > today ? f.start : today) + "T00:00:00");
  while (out.length < 7 && iso(d) <= (f.end || f.start)) {
    out.push(iso(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// 자유 입력에서 시각 찾기: 15:00 · 오후 3시 · 3시 반 · 저녁 6시
function parseTime(text) {
  const m1 = text.match(/(\d{1,2}):(\d{2})/);
  if (m1) return `${pad(m1[1])}:${m1[2]}`;
  const m2 = text.match(/(오전|오후|저녁|밤|낮)?\s*(\d{1,2})\s*시\s*(반|(\d{1,2})\s*분)?/);
  if (!m2) return null;
  let h = Number(m2[2]);
  if (["오후", "저녁", "밤"].includes(m2[1]) && h < 12) h += 12;
  const min = m2[3] === "반" ? 30 : Number(m2[4] || 0);
  return h > 23 ? null : `${pad(h)}:${pad(min)}`;
}
const TIME_CHIPS = [["오전 11시", "11:00"], ["오후 1시", "13:00"], ["오후 3시", "15:00"], ["저녁 6시", "18:00"]];

// 자유 입력에서 날짜 찾기: 2026-11-17 · 11월 17일 · 17일 · 오늘 · 내일 · 모레
function parseDate(text) {
  const now = new Date();
  const m1 = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return `${m1[1]}-${pad(m1[2])}-${pad(m1[3])}`;
  const m2 = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m2) return `${now.getFullYear()}-${pad(m2[1])}-${pad(m2[2])}`;
  const rel = { 오늘: 0, 내일: 1, 모레: 2 };
  for (const [k, v] of Object.entries(rel))
    if (text.includes(k)) {
      const d = new Date(now);
      d.setDate(d.getDate() + v);
      return iso(d);
    }
  const m3 = text.match(/(\d{1,2})\s*일/);
  if (m3) return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(m3[1])}`;
  return null;
}

const ERROR_TEXT = {
  CHECKPOINT_STALE: "대화 상태가 바뀌었어요. ‘새 대화’로 다시 시작해 주세요.",
  RUN_NOT_WAITING: "이미 끝난 대화예요. 새로 요청해 주세요.",
  AUTH_USER_INVALID: "로그인 계정을 확인할 수 없어요. 다시 로그인해 주세요.",
  AUTH_USER_NOT_LINKED: "로그인 계정이 앱 사용자와 연결되지 않았어요. 다시 로그인해 주세요.",
};

export default function AgentChatPanel({ festivals, festivalId, onPickFestival, onResult, pill }) {
  const [messages, setMessages] = useState([]);
  const [run, setRun] = useState(null); // 마지막 에이전트 응답
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const msgsRef = useRef(null);
  const inputRef = useRef(null);
  const festival = (id) => festivals.find((f) => f.id === id);

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [messages.length, busy]);

  // 입력 줄 수에 맞춰 높이 자동 조절 (기존 챗봇과 같은 방식)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "22px";
    el.style.height = Math.min(120, el.scrollHeight - 10) + "px";
  }, [text]);

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
      onResult?.({ status: "done", key: "agent", runId: res.runId, partySize: res.conditions?.party_size, result: { candidates: items }, error: null });
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
      () => startAgentRun({ message: value, festivalId: festivalId || undefined, sessionId: run?.sessionId }),
      value,
    );
  }

  const answerDate = (date) =>
    call(() => resumeAgentRun(run.runId, { checkpointId: run.checkpointId, answers: { date } }), dayLabel(date));

  const answerTime = ([label, startTime]) =>
    call(() => resumeAgentRun(run.runId, { checkpointId: run.checkpointId, answers: { startTime } }), label + "부터 가능해요");

  const answerFestival = (id) => {
    onPickFestival?.(id);
    call(() => resumeAgentRun(run.runId, { checkpointId: run.checkpointId, festivalId: id }), festival(id)?.name || id);
  };

  function reset() {
    if (busy) return;
    setMessages([]);
    setRun(null);
  }

  const botRow = (inner, key) => (
    <div className="ai-row bot" key={key}>
      <span className="ai-ava">🤖</span>
      <div className="ai-col">{inner}</div>
    </div>
  );

  // 에이전트가 어떤 단계·도구를 거쳤는지 (시연용 펼침)
  const traceBox = (res) =>
    res?.trace?.length ? (
      <details className="ai-dev">
        <summary>
          🔧 에이전트 실행 과정 · 단계 {res.trace.length}개 · 도구 호출 {res.toolCalls?.length || 0}회 · 수정 {res.iteration}회
        </summary>
        <pre>
          {res.trace
            .map((t, i) => `${i + 1}. ${t.node}${t.tools?.length ? ` → ${t.tools.join(", ")}` : ""}${t.summary ? ` · ${t.summary}` : ""}`)
            .join("\n")}
        </pre>
      </details>
    ) : null;

  function message(m, i) {
    if (m.role === "user")
      return (
        <div className="ai-row user" key={i}>
          <div className="ai-bubble">{m.text}</div>
        </div>
      );
    if (m.type === "ask") {
      const active = run === m.run && waiting;
      const f = festival(festivalId);
      const dates = festivalDates(f);
      return botRow(
        <>
          <div className="ai-bubble">
            {m.question ||
              (m.missing.includes("festivalId")
                ? "어떤 축제에 참여하실 건가요?"
                : m.missing.includes("date")
                  ? "어느 날짜에 참여하실 건가요?"
                  : m.missing.includes("startTime")
                    ? "몇 시에 참여하실 건가요?"
                    : "조건을 조금 더 알려주세요.")}
            {m.errors.length > 0 && `\n(${m.errors.map((e) => e.message).join(" · ")})`}
          </div>
          {active && m.missing.includes("festivalId") && (
            <div className="ai-card">
              {festivals.slice(0, 6).map((x) => (
                <Button key={x.id} className="ai-fest" onClick={() => answerFestival(x.id)}>
                  <span className="e">{x.emoji}</span>
                  <span>
                    <b>{x.name}</b>
                    <small>
                      📍 {x.region} {x.city} · 📅 {x.start} ~ {x.end}
                    </small>
                  </span>
                </Button>
              ))}
            </div>
          )}
          {active && !m.missing.includes("festivalId") && m.missing.includes("date") && (
            <div className="ai-quick">
              {dates.length ? (
                dates.map((d) => (
                  <Button key={d} className="ai-chip" onClick={() => answerDate(d)}>
                    {dayLabel(d)}
                  </Button>
                ))
              ) : (
                <span className="ai-quick-label">‘11월 20일’처럼 날짜를 적어 주세요</span>
              )}
            </div>
          )}
          {active && !m.missing.includes("festivalId") && !m.missing.includes("date") && m.missing.includes("startTime") && (
            <div className="ai-quick">
              {TIME_CHIPS.map((t) => (
                <Button key={t[1]} className="ai-chip" onClick={() => answerTime(t)}>
                  {t[0]}
                </Button>
              ))}
            </div>
          )}
          {traceBox(m.run)}
        </>,
        i,
      );
    }
    if (m.type === "result") {
      // 백엔드 conditions는 snake_case(start_time …)로 온다 — camelCase도 함께 대응
      const raw = m.run.conditions || {};
      const c = {
        date: raw.date,
        startTime: raw.start_time ?? raw.startTime,
        partySize: raw.party_size ?? raw.partySize,
        budgetManwon: raw.budget_manwon ?? raw.budgetManwon,
        interests: raw.interests,
        travelStyle: raw.travel_style ?? raw.travelStyle,
      };
      const f = festival(festivalId);
      const cond = [
        f?.name,
        c.date && dayLabel(c.date),
        c.startTime && c.startTime + " 시작",
        c.partySize && c.partySize + "명",
        c.budgetManwon && c.budgetManwon + "만원",
        c.interests?.length && c.interests.join("·"),
        c.travelStyle,
      ].filter(Boolean);
      return botRow(
        <>
          {/* 후보 목록·모집글 만들기는 오른쪽 「추천 동행 후보」 패널 한 곳에서만 보여준다 (중복 방지) */}
          <div className="ai-bubble">
            {m.items.length
              ? `동행 후보 ${m.items.length}명을 찾았어요! 🎉\n오른쪽 ‘추천 동행 후보’에서 확인하고 모집글을 만들어 보세요.`
              : "조건에 맞는 동행 후보가 아직 없어요. 조건을 바꿔 다시 말해 주세요."}
            {cond.length > 0 && `\n\n📋 ${cond.join(" · ")}`}
          </div>
          {traceBox(m.run)}
        </>,
        i,
      );
    }
    return botRow(
      <>
        <div className="ai-bubble">{m.text}</div>
        {traceBox(m.run)}
      </>,
      i,
    );
  }

  const hasMessages = messages.length > 0;
  return (
    <section className={`ai-inline ${hasMessages ? "active" : ""}`} aria-label="AI 매칭 도우미">
      <header className="ai-head">
        <span className="ai-ava">🤖</span>
        <div>
          <strong>AI 매칭 도우미</strong>
          <small>원하는 동행을 말하면 에이전트가 빠진 조건을 되묻고 후보를 찾아요</small>
        </div>
        <div className="ai-tools">
          {pill ? pill("🟢 실제 에이전트", "green") : null}
          {hasMessages && (
            <button type="button" title="대화 초기화" onClick={reset}>
              ↺ 새 대화
            </button>
          )}
        </div>
      </header>
      <div className="ai-msgs" ref={msgsRef} aria-live="polite">
        {!hasMessages && (
          <div className="ai-welcome">
            <div className="ai-welcome-ex">
              <span className="ai-quick-label">
                💡 {festival(festivalId) ? `‘${festival(festivalId).name}’ 기준으로 찾아요 · ` : ""}예시를 누르면 바로 보내져요
              </span>
              {examplesFor(festival(festivalId)).map((x) => (
                <Button key={x} className="ai-chip" onClick={() => send(x)}>
                  {x}
                </Button>
              ))}
            </div>
          </div>
        )}
        {messages.map(message)}
        {busy &&
          botRow(
            <div className="ai-bubble typing">
              <i />
              <i />
              <i />
              <em>에이전트가 조건을 확인하는 중</em>
            </div>,
            "typing",
          )}
      </div>
      <form
        className="ai-compose"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <div className="ai-inputwrap">
          <textarea
            id="ai-input"
            ref={inputRef}
            rows="1"
            maxLength="300"
            placeholder={waiting ? "질문에 답해 주세요 (예: 11월 20일 · 오후 3시부터)" : "예) 2명이서 여유롭게 둘러볼 동행 찾아줘"}
            aria-label="동행 조건 입력"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                send(text);
              }
            }}
          />
          <button className="ai-send" type="submit" aria-label="보내기" disabled={!text.trim() || busy}>
            ➤
          </button>
        </div>
        <div className="ai-foot">
          <span>축제·날짜·시작 시간·인원·예산·관심사를 자유롭게 · Shift+Enter 줄바꿈</span>
          <span>{text.length}/300</span>
        </div>
      </form>
    </section>
  );
}
