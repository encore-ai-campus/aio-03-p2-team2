// 챗봇 메시지 한 개 — 사용자 / 되묻기(축제 고르기·날짜·시간 칩) / 매칭 결과 / 일반 답변
import { Link } from "react-router-dom";
import { Button } from "../../../shared/components/Primitives.jsx";
import { firstMissing, isLongRun, pickableFestivals } from "../lib/agentChatInputs.js";
import { ASK_TEXT, FEST_SHOW, TIME_CHIPS, shortDate } from "../lib/agentChatText.js";
import { festivalDates, formatMatchingDate } from "../lib/matchingDates.js";
import { BotRow, TraceBox } from "./AgentBotRow.jsx";
import TypeText from "./TypeText.jsx";

export default function AgentMessage({ m, active, festivals, festival, busy, festQuery, setFestQuery, answerFestival, answerDate, answerTime }) {
  if (m.role === "user")
    return (
      <div className="ai-row user">
        <div className="ai-bubble">{m.text}</div>
      </div>
    );

  if (m.type === "ask") {
    const dates = festivalDates(festival);
    const ask = firstMissing(m.missing); // 이번에 물을 항목 하나
    const options = ask === "festivalId" ? pickableFestivals(festivals, festQuery) : [];
    return (
      <BotRow>
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
        <TraceBox res={m.run} />
      </BotRow>
    );
  }

  if (m.type === "result")
    return (
      <BotRow>
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
        <TraceBox res={m.run} />
      </BotRow>
    );

  return (
    <BotRow>
      <div className="ai-bubble"><TypeText text={m.text} /></div>
      <TraceBox res={m.run} />
    </BotRow>
  );
}
