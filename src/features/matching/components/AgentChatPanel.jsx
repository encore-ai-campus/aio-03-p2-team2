import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../../shared/components/Primitives.jsx";
import { useAgentChat } from "../hooks/useAgentChat.js";
import { firstMissing, isLongRun, pickableFestivals } from "../lib/agentChatInputs.js";
import { festivalDates, formatMatchingDate } from "../lib/matchingDates.js";

// 시간을 일부러 빼 둔 예시 → 에이전트가 "몇 시에 참여하실 건가요?"를 되묻는 장면을 보여줄 수 있다
// 첫 예시는 선택한 축제 이름을 넣는다 (선택 전이면 축제를 되묻는다)
const examplesFor = (f) => [
  // 축제 미선택 예시에 「축제」를 넣지 않음 — 백엔드가 축제 태그 「축제」를 관심사로 해석해 점수가 깎임(A-6)
  f ? `${f.name} 같이 갈 동행 찾아줘` : "같이 갈 동행 찾아줘",
  "2명이서 여유롭게 둘러볼 동행 찾아줘",
  "예산 5만원, 사진·미식 좋아하는 사람이랑 가고 싶어",
];

const TIME_CHIPS = [["오전 11시", "11:00"], ["오후 1시", "13:00"], ["오후 3시", "15:00"], ["저녁 6시", "18:00"]];
const ASK_TEXT = {
  festivalId: "어떤 축제에 함께 갈까요? 아래에서 고르거나 축제 이름을 적어 주세요.",
  date: "어느 날짜에 참여하실 건가요?",
  startTime: "몇 시부터 합류할 수 있나요?",
};
const shortDate = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const FEST_SHOW = 5;

// 챗봇 답변을 실시간으로 쓰는 것처럼 한 글자씩 보여 준다 (처음 나타날 때 한 번만)
const REDUCED = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
function TypeText({ text }) {
  const full = String(text || "");
  const [n, setN] = useState(REDUCED ? full.length : 0);
  useEffect(() => {
    if (n >= full.length) return undefined;
    const step = Math.max(1, Math.ceil(full.length / 45)); // 길이와 상관없이 약 0.8초 안에 끝남
    const t = setTimeout(() => setN((x) => Math.min(full.length, x + step)), 18);
    return () => clearTimeout(t);
  }, [n, full.length]);
  return (
    <>
      {full.slice(0, n)}
      {n < full.length && <span className="ai-caret" aria-hidden="true" />}
    </>
  );
}

export default function AgentChatPanel({ onEditConditions, festivals, festivalId, selectedDate, onPickFestival, onResult, onStage }) {
  const {
    messages, run, busy, waiting, text, setText, festQuery, setFestQuery,
    send, answerDate, answerTime, answerFestival, reset,
  } = useAgentChat({ festivals, festivalId, selectedDate, onPickFestival, onResult, onStage });
  const msgsRef = useRef(null);
  const inputRef = useRef(null);
  const festival = (id) => festivals.find((item) => item.id === id);

  // 새 메시지·글자가 늘어날 때마다 맨 아래로 부드럽게 따라감
  useEffect(() => {
    const el = msgsRef.current;
    if (!el) return undefined;
    const follow = () => el.scrollTo({ top: el.scrollHeight, behavior: REDUCED ? "auto" : "smooth" });
    follow();
    const mo = new MutationObserver(() => {
      el.scrollTop = el.scrollHeight;
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [messages.length, busy]);

  // 입력 줄 수에 맞춰 높이 자동 조절 (기존 챗봇과 같은 방식)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "22px";
    el.style.height = Math.min(120, el.scrollHeight - 10) + "px";
  }, [text]);

  const botRow = (inner, key) => (
    <div className="ai-row bot" key={key}>
      <span className="ai-ava"><img src="/brand/festamate_icon.png" alt="" /></span>
      <div className="ai-col">{inner}</div>
    </div>
  );

  // 에이전트가 어떤 단계·도구를 거쳤는지 (시연용 펼침)
  const traceBox = (res) =>
    res?.trace?.length ? (
      <details className="ai-dev">
        <summary>
          <i className="ti ti-tool" aria-hidden="true" /> 에이전트 실행 과정 · 단계 {res.trace.length}개 · 도구 호출 {res.toolCalls?.length || 0}회 · 수정 {res.iteration}회
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
      const ask = firstMissing(m.missing); // 이번에 물을 항목 하나
      const options = ask === "festivalId" ? pickableFestivals(festivals, festQuery) : [];
      return botRow(
        <>
          <div className="ai-bubble">
            <TypeText
              text={(ask ? ASK_TEXT[ask] : m.question || "조건을 조금 더 알려주세요.") + (m.errors.length > 0 ? `\n(${m.errors.map((e) => e.message).join(" · ")})` : "")}
            />
          </div>
          {active && ask === "festivalId" && (
            <div className="ai-pick">
              <label className="ai-pick-search">
                <i className="ti ti-search" aria-hidden="true" />
                <input
                  value={festQuery}
                  onChange={(e) => setFestQuery(e.target.value)}
                  placeholder="축제 이름·지역 검색"
                  aria-label="축제 검색"
                />
              </label>
              {options.length ? (
                <ul className="ai-pick-list">
                  {options.slice(0, FEST_SHOW).map((x) => (
                    <li key={x.id}>
                      <button type="button" disabled={busy} onClick={() => answerFestival(x.id)}>
                        <b>{x.name}</b>
                        <small>
                          {x.region} · {isLongRun(x) ? "상시 운영" : `${shortDate(x.start)}~${shortDate(x.end || x.start)}`}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ai-pick-empty">{festQuery ? `‘${festQuery}’와 맞는 참여 가능한 축제가 없어요.` : "지금 참여할 수 있는 축제가 없어요."}</p>
              )}
              <div className="ai-pick-foot">
                <span>
                  참여 가능 {options.length}개{options.length > FEST_SHOW ? ` 중 ${FEST_SHOW}개` : ""} · 기간 한정 먼저
                </span>
                <Link to="/festivals">
                  축제 탐색에서 고르기 <i className="ti ti-chevron-right" aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}
          {active && ask === "date" && (
            <div className="ai-quick">
              {dates.length ? (
                dates.map((d) => (
                  <Button key={d} className="ai-chip" onClick={() => answerDate(d)}>
                    {formatMatchingDate(d)}
                  </Button>
                ))
              ) : (
                <span className="ai-quick-label">‘11월 20일’처럼 날짜를 적어 주세요</span>
              )}
            </div>
          )}
          {active && ask === "startTime" && (
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
      return botRow(
        <>
          {/* 후보 목록·모집글 만들기는 오른쪽 「추천 동행 후보」 패널 한 곳에서만 보여준다 (중복 방지) */}
          <div className="ai-bubble">
            <TypeText
              text={
                m.items.length
                  ? `같은 시간에 함께할 수 있는 동행 ${m.items.length}명을 찾았어요 🎉\n오른쪽에서 함께할 동행을 골라 보세요.`
                  : "조건에 맞는 동행 후보가 아직 없어요. 조건을 바꿔 다시 말해 주세요."
              }
            />
          </div>
          {traceBox(m.run)}
        </>,
        i,
      );
    }
    return botRow(
      <>
        <div className="ai-bubble"><TypeText text={m.text} /></div>
        {traceBox(m.run)}
      </>,
      i,
    );
  }

  const hasMessages = messages.length > 0;
  // 마지막 매칭 결과의 조건 → 「확인한 조건」 한 줄 (대화창 아래 고정)
  const lastResult = [...messages].reverse().find((m) => m.type === "result");
  const confirmed = (() => {
    if (!lastResult) return "";
    const raw = lastResult.run.conditions || {};
    const d = raw.date;
    const t = raw.start_time ?? raw.startTime;
    const p = raw.party_size ?? raw.partySize;
    const b = raw.budget_manwon ?? raw.budgetManwon;
    // 축제는 위 축제 카드에 이미 있으므로 조건만 한 줄로
    return [
      d && formatMatchingDate(d),
      t && t + " 시작",
      p && p + "명",
      b && b + "만원",
      raw.interests?.length && raw.interests.join("·"),
    ]
      .filter(Boolean)
      .join(" · ");
  })();
  return (
    <section className={`ai-inline ${hasMessages ? "active" : ""}`} aria-label="AI 매칭 도우미">
      <header className="ai-head">
        <span className="ai-ava"><img src="/brand/festamate_icon.png" alt="" /></span>
        <div>
          <strong>동행 찾기 챗봇</strong>
          <small>원하는 조건을 말하면, 빠진 건 다시 물어보고 동행을 찾아 드려요</small>
        </div>
        <div className="ai-tools">
          {hasMessages && (
            <button type="button" title="처음부터 다시 대화하기" onClick={reset} disabled={busy}>
              <i className="ti ti-refresh" aria-hidden="true" /> 처음부터 다시
            </button>
          )}
        </div>
      </header>
      {confirmed && (
        <div className="ai-confirm">
          <div>
            <b>확인한 조건</b>
            <span>{confirmed}</span>
          </div>
          {onEditConditions && (
            <button type="button" onClick={onEditConditions}>
              조건 수정 <i className="ti ti-chevron-right" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <div className="ai-msgs" ref={msgsRef} aria-live="polite">
        {/* 첫 화면: 대화 칸 가운데에 인사 + 예시 (대화를 시작하면 사라지고 메시지가 위에서부터 쌓임) */}
        {!hasMessages && (
          <div className="ai-intro" key="intro">
            <span className="ai-intro-ava"><img src="/brand/festamate_icon.png" alt="" /></span>
            <h3>
              <TypeText
                key={festivalId || "none"}
                text={festival(festivalId) ? `안녕하세요! ‘${festival(festivalId).name}’에 함께 갈 동행을 찾아 드릴게요` : "어떤 축제에 함께 갈 동행을 찾고 계세요?"}
              />
            </h3>
            <p className="ai-intro-sub">원하는 조건을 편하게 말하거나, 아래 예시를 눌러 보세요.</p>
            <div className="ai-intro-chips">
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
            placeholder={
              !waiting
                ? "예) 2명이서 여유롭게 둘러볼 동행 찾아줘"
                : firstMissing(run.interrupt?.missing) === "festivalId"
                  ? "축제 이름을 적어 주세요 (예: 드론 라이트쇼)"
                  : firstMissing(run.interrupt?.missing) === "date"
                    ? "날짜를 적어 주세요 (예: 11월 20일)"
                    : "시간을 적어 주세요 (예: 오후 3시부터)"
            }
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
            <i className="ti ti-send" aria-hidden="true" />
          </button>
        </div>
        <div className="ai-foot">
          <span>Enter 보내기 · Shift+Enter 줄바꿈</span>
          <span>{text.length}/300</span>
        </div>
      </form>
    </section>
  );
}
