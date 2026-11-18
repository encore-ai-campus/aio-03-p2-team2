import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, ApiLoading } from "../../../shared/components/ApiState.jsx";
import AgentChatPanel from "../components/AgentChatPanel.jsx";
import MatchingConditionsForm from "../components/MatchingConditionsForm.jsx";
import MatchingResults from "../components/MatchingResults.jsx";
import { useMatchingPage } from "../hooks/useMatchingPage.js";
import { formatMatchingDate } from "../lib/matchingDates.js";

export default function MatchingPage() {
  const {
    view, festivals, chosen, festivalId, selectedDate, profile, submitting, formMessage, form,
    result, postSummary, joinLabel, setAgentRun, pickFestival, runApiMatch,
  } = useMatchingPage();
  const [tab, setTab] = useState("chat");
  const [optOpen, setOptOpen] = useState(false);
  const [chatStage, setChatStage] = useState(0);

  function openMore() {
    setTab("form");
    setOptOpen(true);
    requestAnimationFrame(() =>
      document.querySelector(".mp-v3 .tab-form .opt-fold")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  if (view === "loading") return <ApiLoading text="축제 불러오는 중…" />;
  if (view === "error") return <ApiError />;
  if (view === "empty") return (
    <section className="empty" role="status">
      <h2>등록된 축제가 없어요</h2>
      <p>축제 데이터가 등록되면 동행을 찾을 수 있어요.</p>
      <Link to="/festivals">축제 탐색으로 이동</Link>
    </section>
  );
  return (
    <div className="mp-v3">
      <div className="mp-top">
        <div className="mp-top-title">
          <h1>AI 동행 매칭</h1>
          <p>방문 시간과 취향이 잘 맞는 동행을 추천해 드려요</p>
        </div>
        {chosen && (
          <div className="mp-fest">
            <span className="mp-fest-thumb">
              {chosen.imageUrl || chosen.thumbnailUrl ? <img src={chosen.imageUrl || chosen.thumbnailUrl} alt="" /> : <span>{chosen.emoji || "🎪"}</span>}
            </span>
            <span className="mp-fest-txt">
              <b>{chosen.name}</b>
              <small>
                {[chosen.region, chosen.city].filter(Boolean).join(" ")}
                {profile.date ? ` · ${formatMatchingDate(profile.date)}${profile.start ? ` ${profile.start}` : ""}` : ""}
                <i className="ti ti-circle-check" aria-hidden="true" title="축제 정보 실시간 조회" />
              </small>
            </span>
            <Link to="/festivals" className="mp-fest-change">축제 변경</Link>
          </div>
        )}
      </div>
      <div className="match-layout live">
        <div className="match-main">
          <div className="mtabs-card">
            <div className="mtabs" role="tablist" aria-label="동행 찾는 방법">
              <button type="button" role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
                <i className="ti ti-message-chatbot" aria-hidden="true" /> 챗봇으로 찾기
              </button>
              <button type="button" role="tab" aria-selected={tab === "form"} className={tab === "form" ? "on" : ""} onClick={() => setTab("form")}>
                <i className="ti ti-adjustments-horizontal" aria-hidden="true" /> 직접 설정하기
              </button>
            </div>
            {/* 탭을 바꿔도 대화가 사라지지 않도록 챗봇은 숨기기만 한다 */}
            <div hidden={tab !== "chat"}>
              <AgentChatPanel
                festivals={festivals}
                festivalId={festivalId}
                selectedDate={selectedDate}
                onResult={setAgentRun}
                onStage={setChatStage}
                onEditConditions={() => setTab("form")}
                onPickFestival={pickFestival}
              />
            </div>
            <div className="tab-form" hidden={tab !== "form"}>
              <MatchingConditionsForm
                festivals={festivals}
                festival={chosen}
                profile={profile}
                form={form}
                submitting={submitting}
                formMessage={formMessage}
                optOpen={optOpen}
                setOptOpen={setOptOpen}
                onSubmit={runApiMatch}
              />
            </div>
          </div>
        </div>
        <section className={`box pad match-results${result ? " has-result" : ""}`}>
          {result ? (
            <MatchingResults
              key={result.runId || result.key}
              run={result}
              festival={chosen}
              profile={profile}
              summary={postSummary}
              joinLabel={joinLabel}
              onEdit={openMore}
            />
          ) : (
            <div className="ws-empty">
              <span className="ws-empty-ic"><i className="ti ti-users" aria-hidden="true" /></span>
              <h2>추천 동행이 여기에 나타나요</h2>
              <p>대화로 축제·날짜·시간을 정하면 잘 맞는 동행을 찾아 드려요.</p>
              <div className="ws-mini" aria-label="진행 단계">
                {["조건 말하기", "빠진 조건 되묻기", "동행 추천"].map((x, i) => {
                  const now = tab === "chat" ? chatStage : 0;
                  return (
                    <Fragment key={x}>
                      {i > 0 && <i className="ws-mini-bar" aria-hidden="true" />}
                      <span className={i === now ? "now" : i < now ? "done" : ""}>
                        {i < now && <i className="ti ti-check" aria-hidden="true" />}
                        {x}
                      </span>
                    </Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
