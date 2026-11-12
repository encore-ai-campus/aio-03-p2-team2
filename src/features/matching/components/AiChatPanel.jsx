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

// v4.1 · AI 매칭 도우미 패널 (떠 있는 버튼 + 대화 패널)
export default function AiChatPanel({ showFab }) {
  const demo = useDemo();
  const { state, mutate, dispatch, notify, festival, period, person, group, pill, active, today } =
    demo;
  const chat = state.aiChat;
  const [text, setText] = useState("");
  const [placeholder, setPlaceholder] = useState(0);
  const inputRef = useRef(null);
  const msgsRef = useRef(null);

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [chat.messages.length, chat.open]);

  useEffect(() => {
    if (chat.open && !chat.busy) inputRef.current?.focus();
  }, [chat.open, chat.busy]);

  useEffect(() => {
    if (!chat.open) return;
    const id = setInterval(() => {
      if (!inputRef.current?.value && document.activeElement !== inputRef.current)
        setPlaceholder((i) => (i + 1) % AI_PLACEHOLDERS.length);
    }, 3500);
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [chat.open]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "22px";
    el.style.height = Math.min(120, el.scrollHeight - 10) + "px";
  }, [text]);

  function setOpen(open) {
    mutate((s) => {
      s.aiChat.open = open;
    });
  }

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
      s.aiChat.open = false;
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
    setOpen(false);
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
    inputRef.current?.focus();
  }

  function slotsRows(d) {
    const p = state.profile;
    const f = d.festivalId ? festival(d.festivalId) : null;
    return [
      ["🎪", "축제", f ? `${f.emoji} ${f.name} · ${period(f)}` : null, "선택 필요"],
      ["⏰", "시작 시간", d.start, p.start],
      ["💰", "예산", d.budget != null ? d.budget + "만원" : null, p.budget + "만원"],
      ["❤️", "관심사", d.interests?.length ? d.interests.join(" · ") : null, p.interests.join(" · ") || "없음"],
      ["🚶", "스타일", d.style, p.style],
      ["🧩", "선호 MBTI", d.mbti ? (d.mbti.length ? d.mbti.join(", ") : "상관없음") : null, p.mbti.join(", ") || "상관없음"],
      ["👥", "희망 인원", d.party ? d.party + "명" : null, p.party + "명"],
      ["🚪", "입장 방식", d.joinMode ? AI_JOIN[d.joinMode] : null, AI_JOIN[p.joinMode]],
    ];
  }

  function quick(d) {
    const set = !d.start
      ? ["오전 11시부터", "오후 1시부터", "오후 3시부터"]
      : !d.interests?.length
        ? ["맛집·사진", "음악·공연", "산책·카페", "전시·전통"]
        : d.budget == null
          ? ["5만원", "8만원", "10만원", "15만원"]
          : null;
    if (!set) return null;
    const label = !d.start
      ? "⏰ 시작 시간을 알려주면 일정 점수가 정확해져요"
      : !d.interests?.length
        ? "❤️ 관심사를 알려주면 취향 점수가 정확해져요"
        : "💰 예산을 알려주면 예산 점수가 정확해져요";
    return (
      <div className="ai-quick">
        <span className="ai-quick-label">{label}</span>
        {set.map((x) => (
          <Button key={x} className="ai-chip" onClick={() => send(x)}>
            {x}
          </Button>
        ))}
      </div>
    );
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
            {slotsRows(m.draft).map(([ic, k, v, def], idx) => (
              <div className={`ai-slot ${v ? "" : "def"}`} key={k}>
                <span>{ic}</span>
                <span className="k">{k}</span>
                <span className="v">{v || def}</span>
                {v ? (
                  <span className="ai-badge ok">대화</span>
                ) : idx === 0 ? (
                  <span className="ai-badge need">필요</span>
                ) : (
                  <span className="ai-badge">기본값</span>
                )}
              </div>
            ))}
            <div className="ai-legend">
              <b>대화</b> = 문장에서 인식 · <b>기본값</b> = 현재 매칭 폼 설정
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
          {!m.stale && quick(m.draft)}
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
    <>
      <button
        type="button"
        className={`ai-fab ${showFab && !chat.open ? "" : "hidden"}`}
        aria-label="AI 매칭 도우미 열기"
        onClick={() => setOpen(true)}
      >
        <span>💬</span>
        <b>말로 매칭하기</b>
      </button>
      <section
        className={`ai-panel ${chat.open ? "open" : ""}`}
        role="dialog"
        aria-label="AI 매칭 도우미"
        aria-hidden={!chat.open}
      >
        <header className="ai-head">
          <span className="ai-ava">🤖</span>
          <div>
            <strong>AI 매칭 도우미</strong>
            <small>문장으로 말하면 매칭 조건으로 바꿔드려요</small>
          </div>
          <div className="ai-tools">
            <button type="button" title="대화와 인식한 조건 초기화" onClick={resetChat}>
              ↺ 새 대화
            </button>
            <button type="button" aria-label="닫기" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
        </header>
        <div className="ai-msgs" ref={msgsRef} aria-live="polite">
          {botRow(
            <>
              <div className="ai-bubble">
                안녕하세요! 페스타메이트 AI 매칭 도우미예요.{"\n"}가고 싶은 축제와 원하는 동행 조건을{" "}
                <b>편하게 문장으로</b> 적어주세요. 매칭 조건으로 정리해 드릴게요.
              </div>
              <div className="ai-guide">
                <div className="ai-guide-title">💡 이렇게 써보세요 · 누르면 바로 보내져요</div>
                {AI_EXAMPLES.map((x, idx) => (
                  <Button key={idx} className="ai-example" onClick={() => send(x)}>
                    {x}
                  </Button>
                ))}
                <div className="ai-slots">
                  알아듣는 조건{" "}
                  {["축제·지역·날짜", "시작 시간", "예산", "관심사", "여행 스타일", "MBTI", "인원", "입장 방식"].map((x) => (
                    <span key={x}>{x}</span>
                  ))}
                </div>
              </div>
            </>,
            "welcome",
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
    </>
  );
}
