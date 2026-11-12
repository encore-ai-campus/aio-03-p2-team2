import { useEffect, useRef, useState } from "react";
import { useDemo } from "../../../app/DemoProvider.jsx";
import { Button } from "../../../shared/components/Primitives.jsx";
import {
  AI_EXAMPLES,
  AI_EXAMPLE_LABELS,
  AI_JOIN,
  AI_LABEL,
  AI_PLACEHOLDERS,
  aiArgs,
  aiParse,
} from "../lib/aiParse.js";
import {
  aiCanRun,
  aiApply,
  aiMarkStale,
  aiPush,
  aiReply,
  aiRunResult,
  aiStartTyping,
  aiStopTyping,
} from "../lib/aiChat.js";

const RESET = /^(초기화|처음부터|새로\s*시작|리셋)/;

// v4.4 · AI 매칭 도우미 (매칭 화면 메인 대화창, 페이지 안에 고정)
export default function AiChatPanel() {
  const demo = useDemo();
  const { state, mutate, dispatch, notify, festival, period, person, group, pill, active, today } =
    demo;
  const chat = state.aiChat;
  const [text, setText] = useState("");
  const [placeholder, setPlaceholder] = useState(0);
  const inputRef = useRef(null);
  const msgsRef = useRef(null);

  const hasMessages = chat.messages.length > 0;

  // 대화가 늘어나면 대화창 안에서만 아래로 스크롤 (페이지 전체는 움직이지 않음)
  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [chat.messages.length]);

  // 대화 중일 때만 응답 후 입력창에 다시 포커스
  useEffect(() => {
    if (hasMessages && !chat.busy) inputRef.current?.focus({ preventScroll: true });
  }, [hasMessages, chat.busy]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!inputRef.current?.value && document.activeElement !== inputRef.current)
        setPlaceholder((i) => (i + 1) % AI_PLACEHOLDERS.length);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "22px";
    el.style.height = Math.min(120, el.scrollHeight - 10) + "px";
  }, [text]);

  function later(ms, fn) {
    setTimeout(() => mutate(fn), ms);
  }

  function send(raw) {
    const value = String(raw || "").trim();
    if (!value || chat.busy) return;
    setText("");
    if (RESET.test(value)) {
      mutate((s) => {
        aiPush(s, { role: "user", text: value });
        aiStartTyping(s);
      });
      later(450, (s) => {
        aiStopTyping(s);
        s.aiChat.draft = {};
        aiMarkStale(s);
        aiPush(s, {
          role: "bot",
          type: "text",
          text: "조건을 모두 비웠어요. 원하는 축제와 동행 조건을 다시 알려주세요!",
        });
      });
      return;
    }
    const parsed = aiParse(value, { festivals: state.festivals, active, today });
    mutate((s) => {
      aiPush(s, { role: "user", text: value });
      aiStartTyping(s);
    });
    later(700, (s, model) => {
      aiStopTyping(s);
      if (aiReply(s, model, parsed) === "run") {
        aiMarkStale(s);
        if (aiCanRun(s, model)) aiRunResult(s, model);
      }
    });
  }

  function run() {
    if (chat.busy) return;
    let ok = false;
    mutate((s, model) => {
      aiPush(s, { role: "user", text: "이 조건으로 매칭해 줘" });
      aiMarkStale(s);
      ok = aiCanRun(s, model);
      if (ok) aiStartTyping(s, "6개 요소로 점수 계산 중");
    });
    if (ok)
      later(900, (s, model) => {
        aiStopTyping(s);
        aiRunResult(s, model);
      });
  }

  function pickFest(id) {
    if (chat.busy) return;
    const f = festival(id);
    mutate((s) => {
      aiPush(s, { role: "user", text: f.name });
      aiStartTyping(s);
    });
    later(450, (s, model) => {
      aiStopTyping(s);
      aiReply(s, model, { text: f.name, slots: {}, fest: { id, options: [] } });
    });
  }

  function toForm() {
    mutate((s) => {
      aiApply(s);
      s.matchingDone = false;
      s.formOpen = true;
    });
    requestAnimationFrame(() => {
      const el = document.querySelector(".match-form");
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1700);
    });
    notify("대화 내용을 매칭 폼에 반영했어요. 확인·수정 후 매칭을 실행하세요.");
  }

  function showResults() {
    requestAnimationFrame(() =>
      document.querySelector(".match-results")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  function resetChat() {
    if (chat.busy) return;
    mutate((s) => {
      s.aiChat.messages = [];
      s.aiChat.draft = {};
    });
    notify("새 대화를 시작했어요.");
    inputRef.current?.focus({ preventScroll: true });
  }

  // 조건 행: [아이콘, 이름, 대화 값, 폼(직접 설정) 값, 필수 여부]
  function slotsRows(d) {
    const p = state.profile;
    const fd = d.festivalId ? festival(d.festivalId) : null;
    const fp = state.festivalId ? festival(state.festivalId) : null;
    const fl = (f) => (f ? `${f.emoji} ${f.name} · ${period(f)}` : null);
    return [
      ["🎪", "축제", fl(fd), fl(fp), true],
      ["⏰", "시작 시간", d.start, p.start || null, true],
      ["👥", "희망 인원", d.party ? d.party + "명" : null, p.party ? p.party + "명" : null, true],
      ["💰", "예산", d.budget != null ? d.budget + "만원" : null, p.budget ? p.budget + "만원" : null, false],
      ["❤️", "관심사", d.interests?.length ? d.interests.join(" · ") : null, p.interests.join(" · ") || null, false],
      ["🚶", "스타일", d.style, p.style || null, false],
      [
        "🧩",
        "선호 MBTI",
        d.mbti ? (d.mbti.length ? d.mbti.join(", ") : "상관없음") : null,
        p.mbti.length ? p.mbti.join(", ") : null,
        false,
      ],
      ["🚪", "입장 방식", d.joinMode ? AI_JOIN[d.joinMode] : null, AI_JOIN[p.joinMode], false],
    ];
  }

  function botRow(inner, key) {
    return (
      <div className="ai-row bot" key={key}>
        <span className="ai-ava">🤖</span>
        <div className="ai-col">{inner}</div>
      </div>
    );
  }

  function message(m, i) {
    if (m.role === "user")
      return (
        <div className="ai-row user" key={i}>
          <div className="ai-bubble">{m.text}</div>
        </div>
      );
    if (m.type === "typing")
      return botRow(
        <div className="ai-bubble typing">
          <i />
          <i />
          <i />
          {m.text ? <em>{m.text}</em> : null}
        </div>,
        i,
      );
    const bubble = <div className="ai-bubble">{m.text}</div>;
    if (m.type === "summary")
      return botRow(
        <>
          {bubble}
          <div className="ai-card">
            <div className="ai-card-title">
              📋 이해한 매칭 조건 {pill("6개 요소 점수화", "blue")}
            </div>
            {slotsRows(m.draft).map(([ic, k, v, form, req]) => (
              <div className={`ai-slot ${v ? "" : "def"}`} key={k}>
                <span>{ic}</span>
                <span className="k">
                  {k}
                  {req ? " *" : ""}
                </span>
                <span className="v">{v || form || (req ? "입력 필요" : "미설정 · 점수 제외")}</span>
                {v ? (
                  <span className="ai-badge ok">대화</span>
                ) : form ? (
                  <span className="ai-badge">직접 설정</span>
                ) : req ? (
                  <span className="ai-badge need">필요</span>
                ) : (
                  <span className="ai-badge">미설정</span>
                )}
              </div>
            ))}
            <div className="ai-legend">
              <b>*</b> 필수 조건 · <b>대화</b> = 문장에서 인식 · <b>직접 설정</b> = 조건 설정 값 ·{" "}
              <b>미설정</b> 선택 조건은 점수에서 제외해요.
              <br />
              매칭하면 공개 모집글과 모임방이 자동으로 만들어져요.
            </div>
            {!m.stale && (
              <div className="ai-actions">
                <Button className="btn primary" onClick={run}>
                  이 조건으로 매칭
                </Button>
                <Button className="btn" onClick={toForm}>
                  폼에서 직접 수정
                </Button>
              </div>
            )}
            <details className="ai-dev">
              <summary>🔧 추출 결과 (실서비스: LLM Function Calling 인자)</summary>
              <pre>
                {JSON.stringify({ name: "extract_match_conditions", arguments: aiArgs(m.draft) }, null, 2)}
              </pre>
            </details>
          </div>
        </>,
        i,
      );
    if (m.type === "ask")
      return botRow(
        <>
          {bubble}
          <div className="ai-card">
            {m.options.map((id) => {
              const f = festival(id);
              return (
                <Button key={id} className="ai-fest" disabled={m.stale} onClick={() => pickFest(id)}>
                  <span className="e">{f.emoji}</span>
                  <span>
                    <b>{f.name}</b>
                    <small>
                      📍 {f.region} {f.city} · 📅 {period(f)}
                    </small>
                  </span>
                </Button>
              );
            })}
            {Object.keys(m.draft || {}).length > 0 && (
              <div className="ai-legend">
                지금까지 이해한 조건:{" "}
                {Object.keys(m.draft)
                  .filter((k) => AI_LABEL[k])
                  .map((k) => AI_LABEL[k](m.draft[k]))
                  .join(" · ") || "—"}
              </div>
            )}
          </div>
        </>,
        i,
      );
    if (m.type === "askText")
      return botRow(
        <>
          {bubble}
          {!m.stale && (
            <div className="ai-quick">
              {m.chips.map((x) => (
                <Button key={x} className="ai-chip" onClick={() => send(x)}>
                  {x}
                </Button>
              ))}
            </div>
          )}
        </>,
        i,
      );
    if (m.type === "fallback")
      return botRow(
        <>
          {bubble}
          {!m.stale && (
            <div className="ai-quick">
              <span className="ai-quick-label">예시로 시작해 보세요</span>
              {AI_EXAMPLES.map((x, idx) => (
                <Button key={idx} className="ai-chip" onClick={() => send(x)}>
                  {AI_EXAMPLE_LABELS[idx]}
                </Button>
              ))}
            </div>
          )}
        </>,
        i,
      );
    if (m.type === "result") {
      const f = festival(m.festivalId);
      const g = group(m.groupId);
      return botRow(
        <>
          <div className="ai-bubble">
            {`매칭 완료! 🎉\n${f.name} 기준 추천 동행 상위 ${m.scores.length}명이에요. 모임방과 공개 모집글도 함께 만들었어요.`}
          </div>
          <div className="ai-card">
            <div className="ai-card-title">
              🤝 추천 동행 TOP {m.scores.length} {pill("가중치 점수", "green")}
            </div>
            {m.scores.length ? (
              m.scores.map((x) => {
                const p = person(x.id);
                return (
                  <div className="ai-cand" key={x.id}>
                    <span className="ai-ava">{p.emoji}</span>
                    <div>
                      <b>{p.name}</b>
                      <div className="tiny muted">
                        {p.style} · {p.interests.join(" · ")}
                      </div>
                    </div>
                    <span className="s">{x.score}%</span>
                  </div>
                );
              })
            ) : (
              <div className="tiny muted">조건에 맞는 후보가 없어요.</div>
            )}
            <div className="ai-actions">
              <Button className="btn small" onClick={showResults}>
                전체 결과 보기
              </Button>
              {g && (
                <Button className="btn small primary" onClick={() => dispatch(`openGroup:${g.id}`)}>
                  모집글 보기 →
                </Button>
              )}
            </div>
          </div>
          <div className="ai-tip">
            조건을 바꾸려면 “예산 15만원으로 바꿔줘”처럼 말해 주세요. 바뀐 조건으로 다시 매칭할 수 있어요.
          </div>
        </>,
        i,
      );
    }
    return botRow(bubble, i);
  }

  return (
    <section className={`ai-inline ${hasMessages ? "active" : ""}`} aria-label="AI 매칭 도우미">
        <header className="ai-head">
          <span className="ai-ava">🤖</span>
          <div>
            <strong>AI 매칭 도우미</strong>
            <small>가고 싶은 축제와 원하는 동행을 말하면 매칭 조건으로 정리해 드려요</small>
          </div>
          <div className="ai-tools">
            {hasMessages && (
              <button type="button" title="대화와 인식한 조건 초기화" onClick={resetChat}>
                ↺ 새 대화
              </button>
            )}
          </div>
        </header>
        <div className="ai-msgs" ref={msgsRef} aria-live="polite">
          {!hasMessages && (
            <div className="ai-welcome">
              <div className="ai-welcome-ex">
                <span className="ai-quick-label">💡 예시를 누르면 바로 보내져요</span>
                {AI_EXAMPLES.map((x, idx) => (
                  <Button key={idx} className="ai-chip" title={x} onClick={() => send(x)}>
                    {AI_EXAMPLE_LABELS[idx]}
                  </Button>
                ))}
              </div>
              <div className="ai-slots">
                알아듣는 조건{" "}
                {["축제·지역·날짜", "시작 시간", "예산", "관심사", "여행 스타일", "MBTI", "인원", "입장 방식"].map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
            </div>
          )}
          {chat.messages.map(message)}
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
              placeholder={AI_PLACEHOLDERS[placeholder]}
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
            <button className="ai-send" type="submit" aria-label="보내기" disabled={!text.trim() || chat.busy}>
              ➤
            </button>
          </div>
          <div className="ai-foot">
            <span>축제·시간·예산·관심사·인원 등을 자유롭게 · Shift+Enter 줄바꿈</span>
            <span>{text.length}/300</span>
          </div>
        </form>
    </section>
  );
}
