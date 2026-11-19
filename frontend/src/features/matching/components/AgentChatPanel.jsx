// 동행 찾기 챗봇 패널 — 대화 상태·API는 hooks/useAgentChat, 메시지는 AgentMessage, 문구·조건 한 줄은 lib/agentChatText
import { useEffect, useRef } from "react";
import { Button } from "../../../shared/components/Primitives.jsx";
import { useAgentChat } from "../hooks/useAgentChat.js";
import { confirmedConditions, examplesFor, inputPlaceholder } from "../lib/agentChatText.js";
import { BotRow } from "./AgentBotRow.jsx";
import AgentMessage from "./AgentMessage.jsx";
import TypeText, { REDUCED } from "./TypeText.jsx";

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

  const hasMessages = messages.length > 0;
  const confirmed = confirmedConditions(messages); // 「확인한 조건」 한 줄 (대화창 아래 고정)
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
                text={festival(festivalId) ? `안녕하세요! ‘${festival(festivalId).name}’에\n함께 갈 동행을 찾아 드릴게요` : "어떤 축제에 함께 갈 동행을 찾고 계세요?"}
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
        {messages.map((m, i) => (
          <AgentMessage
            key={i}
            m={m}
            active={run === m.run && waiting}
            festivals={festivals}
            festival={festival(festivalId)}
            busy={busy}
            festQuery={festQuery}
            setFestQuery={setFestQuery}
            answerFestival={answerFestival}
            answerDate={answerDate}
            answerTime={answerTime}
          />
        ))}
        {busy && (
          <BotRow key="typing">
            <div className="ai-bubble typing">
              <i />
              <i />
              <i />
              <em>에이전트가 조건을 확인하는 중</em>
            </div>
          </BotRow>
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
            placeholder={inputPlaceholder(waiting, run)}
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
