import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { useDemo } from "../../../app/DemoProvider.jsx";
import AiChatPanel from "../components/AiChatPanel.jsx";
import AgentChatPanel from "../components/AgentChatPanel.jsx";
import { AI_JOIN } from "../lib/aiParse.js";
import { recruitmentJoinMode } from "../lib/matchingConditions.js";
import { SOURCE_LABEL, useFestivals } from "../../festivals/hooks/useFestivals.js";
import { DEMO_MODE } from "../../../shared/lib/demoMode.js";
import { ApiError, ApiLoading } from "../../../shared/components/ApiState.jsx";
import { conditionKey, useMatchingRun } from "../hooks/useMatchingRun.js";
import CreatePostBox from "../../groups/components/CreatePostBox.jsx";

const INTERESTS = ["미식", "사진", "산책", "음악", "문화", "전통", "자연", "카페", "액티비티"];
// 온보딩과 같은 이모지로 통일
const INTEREST_EMOJI = { 미식: "🍜", 사진: "📸", 산책: "🚶", 음악: "🎵", 문화: "🎨", 전통: "🏮", 자연: "🌳", 카페: "☕", 액티비티: "🎢" };
const STYLE_EMOJI = { 여유롭게: "🌿", 활동적으로: "⚡", 계획적으로: "📋" };
const JOIN_OPTIONS = [
  ["approval", "✋ 승인 후 참여"],
  ["instant", "🚀 바로 참여"],
];
const MBTIS = [
  "ISTJ", "ISFJ", "INFJ", "INTJ", "ISTP", "ISFP", "INFP", "INTP",
  "ESTP", "ESFP", "ENFP", "ENTP", "ESTJ", "ESFJ", "ENFJ", "ENTJ",
];

// "2026-11-17" → "11/17(화)"
const dayLabel = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}(${"일월화수목금토"[d.getDay()]})`;
};

// v4.4 · 왼쪽: 챗봇(메인) + 접힌 직접 조건 설정 / 오른쪽: 추천 동행 후보
export default function MatchingPage() {
  const demo = useDemo();
  const { state, btn, pill, fieldProps, festival, person, active, dateShort, pageHead, mutate } = demo;
  const pr = state.profile;
  // 축제 목록: 실제 API 우선, 실패 시 데모 데이터 (축제 탐색 화면과 같은 규칙)
  const { festivals: liveFestivals, source } = useFestivals(state.festivals);
  const useApi = source === "api";
  const findFestival = (id) => liveFestivals.find((x) => x.id === id) || festival(id);
  const isOpen = (x) => (x.apiStatus ? x.apiStatus !== "past" && x.riskStatus !== "cancelled" : active(x));
  const f = findFestival(state.festivalId) || liveFestivals.find(isOpen) || liveFestivals[0];
  const all = liveFestivals.filter(isOpen);
  // 직접 조건 매칭(실제 API) — 조건이 바뀌면 이전 결과는 숨긴다
  const { run, execute } = useMatchingRun();
  const [formMsg, setFormMsg] = useState("");
  // 오른쪽 패널 결과: 챗봇(에이전트) 결과가 있으면 우선, 없으면 직접 조건 매칭 결과
  const [agentRun, setAgentRun] = useState(null);
  // 실서버 모드: 왼쪽 카드 탭 (챗봇으로 찾기 / 직접 설정하기)
  const [tab, setTab] = useState("chat");
  const directResult = useApi && run.key === conditionKey(state.festivalId, pr) ? run : null;
  const apiResult = useApi ? agentRun || directResult : null;
  const showDemoResult = !useApi && state.matchingDone;
  const runApiMatch = () => {
    const missing = [
      !all.some((x) => x.id === state.festivalId) && "축제",
      !pr.date && "참여 날짜",
      !pr.start && "시작 시간",
      !pr.party && "희망 인원",
    ].filter(Boolean);
    if (missing.length) return setFormMsg(`필수 조건을 입력해 주세요: ${missing.join(", ")}`);
    const selected = findFestival(state.festivalId);
    if (pr.date < selected.start || pr.date > selected.end) return setFormMsg("참여 날짜는 축제 운영 기간 안에서 선택해 주세요.");
    setFormMsg("");
    setAgentRun(null);
    execute(state.festivalId, pr);
  };
  const [sourceText, sourceClass] = SOURCE_LABEL[source];
  const candidates = state.matchingDone
    ? (state.matchScores || []).map((x) => ({ ...x, p: person(x.id) }))
    : [];
  const matchingGroup = state.groups.find(
    (g) => g.leader === state.actor && g.id === state.matchGroupId,
  );
  const chosen = state.festivalId ? findFestival(state.festivalId) : null;
  const summaryItems = [
    chosen?.name,
    pr.date && dayLabel(pr.date),
    pr.start && pr.start + " 시작",
    pr.party && pr.party + "명",
    pr.budget && pr.budget + "만원",
    pr.interests.length && pr.interests.join("·"),
    pr.style,
    pr.mbti.length && "MBTI " + pr.mbti.join("/"),
  ].filter(Boolean);
  const summary = summaryItems.length
    ? [...summaryItems, AI_JOIN[pr.joinMode]].join(" · ")
    : "아직 설정한 조건이 없어요 · 챗봇에 말하거나 여기서 직접 설정하세요";

  // 챗봇(에이전트) 매칭 결과가 있으면 챗봇에서 받은 조건으로 요약한다
  const ac = agentRun?.conditions;
  const agentBits = ac
    ? [
        ac.date && dayLabel(ac.date),
        ac.startTime && ac.startTime + " 시작",
        ac.partySize && ac.partySize + "명",
      ].filter(Boolean)
    : [];
  const foldSummary = agentBits.length ? [chosen?.name, ...agentBits, AI_JOIN[recruitmentJoinMode(agentRun, pr.joinMode)]].filter(Boolean).join(" · ") : summary;
  // 모집글 본문은 바로 위 줄에 축제명이 있으므로 축제명 없이
  const postSummary = agentBits.length ? [...agentBits, AI_JOIN[recruitmentJoinMode(agentRun, pr.joinMode)]].filter(Boolean).join(" · ") : summary;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentCond]);

  const setFormOpen = (open) =>
    mutate((s) => {
      s.formOpen = open;
    });

  // 직접 조건 설정 폼 (실서버: 「직접 설정하기」 탭 / 데모: 접는 상자)
  const formBody = (
        <div className="form-body form-v3">
          <div className="form-group-title">필수 조건</div>
          <div className="form-req">
            <div className="field">
              <label htmlFor="match-festival">참여할 축제</label>
              <select id="match-festival" {...fieldProps("match-festival")}>
                <option value="">축제 선택</option>
                {all.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {dateShort(x.start)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="match-date">참여 날짜</label>
              <input
                id="match-date"
                type="date"
                min={chosen?.start}
                max={chosen?.end}
                value={pr.date || ""}
                onChange={(e) =>
                  mutate((s) => {
                    s.profile.date = e.target.value;
                  })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="match-start">합류 가능 시각</label>
              <input id="match-start" type="time" {...fieldProps("match-start")} />
            </div>
            <div className="field">
              <label htmlFor="match-cap">모임 정원</label>
              <select id="match-cap" {...fieldProps("match-cap")}>
                <option value="">선택</option>
                {[2, 3, 4, 5, 6, 7, 8].map((x) => (
                  <option key={x} value={x}>
                    {x}명
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 매칭 실행: 필수 조건 바로 아래 (선택 조건을 펼치지 않아도 바로 실행) */}
          <div className="form-run">
            <details className="fold score-info">
              <summary>
                <i className="ti ti-info-circle" aria-hidden="true" /> 점수 계산 방식
              </summary>
              <div className="score-grid">
                <span>일정 25%</span>
                <span>관심사 20%</span>
                <span>예산 20%</span>
                <span>여행 스타일 15%</span>
                <span>MBTI 10%</span>
                <span>희망 인원 10%</span>
              </div>
              <p>선택 조건을 비워 두면 그 항목은 빼고, 나머지로 100점 기준을 다시 계산해요.</p>
            </details>
            {useApi ? (
              <button type="button" className="btn primary" disabled={run.status === "loading"} onClick={runApiMatch}>
                {run.status === "loading" ? "매칭 중…" : "이 조건으로 매칭하기"}
              </button>
            ) : (
              btn("이 조건으로 매칭하기", "runMatch", "btn primary")
            )}
            {!useApi && <span className={sourceClass}>{sourceText}</span>}
            {formMsg && <p className="run-hint" role="alert"><strong>{formMsg}</strong></p>}
            {!useApi && (
              <p className="run-hint">
                챗봇에서 말한 조건도 여기에 반영돼요. 실행하면 공개 모집글과 모임방이 자동으로 만들어지고, 추천된 사람이 자동으로 참여하지는 않아요.
              </p>
            )}
          </div>

          {/* 선택 조건: 기본 접힘 · 한 줄에 한 항목(왼쪽 소제목 / 오른쪽 선택) */}
          <details className="opt-fold">
            <summary>
              <span className="opt-title">
                <i className="ti ti-help-circle" aria-hidden="true" /> 더 잘 맞는 동행을 찾으려면 <em>(선택)</em>
              </span>
              <span className="opt-sum">
                {[pr.style, pr.budget && `${pr.budget}만원`, pr.interests.length && pr.interests.join(", "), pr.mbti.length && pr.mbti.join("/")]
                  .filter(Boolean)
                  .join(" · ") || "비워 두면 점수에서 빠져요"}
              </span>
              <i className="ti ti-chevron-down chev" aria-hidden="true" />
            </summary>
            <div className="opt-rows">
              <div className="opt-row">
                <span className="opt-label">여행 스타일</span>
                <div className="seg seg-3" role="group" aria-label="여행 스타일">
                  {["여유롭게", "활동적으로", "계획적으로"].map((x) => (
                    <button
                      key={x}
                      type="button"
                      className={pr.style === x ? "on" : ""}
                      aria-pressed={pr.style === x}
                      onClick={() =>
                        mutate((s) => {
                          s.profile.style = s.profile.style === x ? "" : x;
                        })
                      }
                    >
                      {STYLE_EMOJI[x]} {x}
                    </button>
                  ))}
                </div>
              </div>
              <div className="opt-row">
                <label className="opt-label" htmlFor="match-budget">여행 예산</label>
                {/* 직접 입력 — 온보딩·챗봇에서 정한 값이 있으면 미리 채워진다(위 채우기 로직) */}
                <div className="budget-field">
                  <div className="budget-input">
                    <input
                      id="match-budget"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      step={1}
                      placeholder="예) 8"
                      value={pr.budget || ""}
                      onChange={(e) => {
                        const n = e.target.value.replace(/[^0-9]/g, "");
                        const v = n === "" ? "" : String(Math.min(100, Math.max(1, Number(n))));
                        mutate((s) => {
                          s.profile.budget = v;
                        });
                      }}
                    />
                    <span>만 원</span>
                  </div>
                  <small>1인 기준 · 예) 5, 10, 15 · 비워 두면 예산은 보지 않아요</small>
                </div>
              </div>
              <div className="opt-row">
                <span className="opt-label">
                  관심사 <small>여러 개</small>
                </span>
                <div className="grid-chips g5">
                  {INTERESTS.map((x) => (
                    <Fragment key={x}>
                      {btn(`${INTEREST_EMOJI[x]} ${x}`, `interest:${x}`, `chip ${pr.interests.includes(x) ? "active" : ""}`)}
                    </Fragment>
                  ))}
                </div>
              </div>
              <div className="opt-row">
                <span className="opt-label">
                  선호 MBTI <small>여러 개</small>
                </span>
                <div className="grid-chips g8">
                  {MBTIS.map((x) => (
                    <Fragment key={x}>
                      {btn(x, `mbti:${x}`, `chip ${pr.mbti.includes(x) ? "active" : ""}`)}
                    </Fragment>
                  ))}
                </div>
              </div>
              <div className="opt-row">
                <span className="opt-label">참여 방식</span>
                <div className="seg seg-2" role="group" aria-label="참여 방식">
                  {JOIN_OPTIONS.map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      className={(pr.joinMode || "approval") === v ? "on" : ""}
                      aria-pressed={(pr.joinMode || "approval") === v}
                      onClick={() =>
                        mutate((s) => {
                          s.profile.joinMode = v;
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>
  );

  // 데모 모드가 아니면: 불러오는 중엔 스켈레톤, 연결 실패면 안내 (예전 데모 화면이 먼저 뜨던 문제)
  if (!DEMO_MODE && source === "loading") return <ApiLoading text="축제 불러오는 중…" />;
  if (!DEMO_MODE && source === "demo") return <ApiError />;
  return (
    <>
      {/* 실서버 모드: v3 머리글 — 제목·설명 왼쪽, 진행 단계 오른쪽 (실제 진행한 단계까지만 ✓) */}
      {useApi ? (
        <div className="mp-head">
          <div>
            <h1>AI 동행 매칭</h1>
            <p>방문 시간과 취향을 바탕으로 잘 맞는 동행을 추천해 드려요 🙌</p>
          </div>
          <ol className="mp-steps" aria-label="매칭 진행 단계">
            {["조건 확인", "동행 추천", "모집글 작성", "신청·승인"].map((x, i) => {
              const doneCount = apiResult?.status === "done" ? 2 : agentRun ? 1 : 0;
              const cls = i < doneCount ? "done" : i === doneCount ? "cur" : "";
              return (
                <li key={x} className={cls}>
                  {i < doneCount ? <i className="ti ti-circle-check" aria-hidden="true" /> : <span>{String(i + 1).padStart(2, "0")}</span>}
                  {x}
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        pageHead(
          "AI TRAVEL MATCHING",
          "💞 AI 동행 매칭",
          "가고 싶은 축제와 원하는 동행을 말로 적으면 AI가 조건을 정리해 추천하고, 공개 모집글과 모임방을 만들어요.",
        )
      )}

      {/* 실서버 모드: 지금 고른 축제 카드 */}
      {useApi && chosen && (
        <div className="fest-ctx">
          <div className="fest-ctx-thumb">
            {chosen.imageUrl || chosen.thumbnailUrl ? <img src={chosen.imageUrl || chosen.thumbnailUrl} alt="" /> : <span className="fest-ctx-emoji">{chosen.emoji || "🎪"}</span>}
          </div>
          <div className="fest-ctx-name">
            <h3>{chosen.name}</h3>
            <span>
              {[chosen.region, chosen.city].filter(Boolean).join(" ")}
              {chosen.start ? ` · ${chosen.start.slice(5).replace("-", ".")} – ${(chosen.end || chosen.start).slice(5).replace("-", ".")}` : ""}
            </span>
            <small className="fest-ctx-src">
              <i className="ti ti-circle-check" aria-hidden="true" /> 축제 정보 · 실시간 조회
            </small>
          </div>
          <div className="fest-ctx-visit">
            <small>방문 예정</small>
            <b>{pr.date ? `${dayLabel(pr.date)}${pr.start ? ` · ${pr.start}` : ""}` : "아직 정하지 않았어요"}</b>
          </div>
          <Link to="/festivals" className="fest-ctx-change">
            축제 변경 <i className="ti ti-chevron-right" aria-hidden="true" />
          </Link>
        </div>
      )}

      {/* 데모 모드 진행 단계 (기존) */}
      {useApi ? null : (
      <ol className={`workflow ${showDemoResult ? "done" : ""}`} aria-label="매칭 진행 단계">
        {["조건 말하기", "AI 점수 계산", "모임방 생성", "모집글 등록"].map((x, i) => (
          <li className="step" key={x}>
            <b>{showDemoResult ? "✓" : i + 1}</b>
            {x}
          </li>
        ))}
      </ol>
      )}

      <div className={`match-layout${useApi ? " live" : ""}`}>
      <div className="match-main">
      {useApi ? (
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
          festivals={all}
          festivalId={state.festivalId}
          selectedDate={chosen && pr.date >= chosen.start && pr.date <= chosen.end ? pr.date : undefined}
          pill={pill}
          onResult={setAgentRun}
          onEditConditions={() => setTab("form")}
          onPickFestival={(id) =>
            mutate((s) => {
              s.festivalId = id;
              s.matchingDone = false;
            })
          }
        />
          </div>
          <div className="tab-form" hidden={tab !== "form"}>
            {formBody}
          </div>
        </div>
      ) : (
        <AiChatPanel />
      )}

      {!useApi && (
      <details
        className="box match-form form-fold"
        open={!!state.formOpen}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          if (open !== !!state.formOpen) setFormOpen(open);
        }}
      >
        <summary>
          <span className="form-fold-title">직접 조건 설정</span>
          <span className="form-fold-sum">
            {useApi
              ? [pr.date && dayLabel(pr.date), pr.start && pr.start + " 시작", pr.party && pr.party + "명"].filter(Boolean).join(" · ") || "아직 설정한 조건이 없어요"
              : foldSummary}
          </span>
          <span className="form-fold-cta">
            {state.formOpen ? "접기" : "수정"} <i className="ti ti-chevron-down chev" aria-hidden="true" />
          </span>
        </summary>
        {formBody}
      </details>
      )}
      </div>

      <section className="box pad match-results">
        {apiResult ? (
          <ApiResults run={apiResult} festival={findFestival(state.festivalId)} profile={pr} summary={postSummary} pill={pill} joinLabel={AI_JOIN[recruitmentJoinMode(agentRun, pr.joinMode)]} />
        ) : showDemoResult ? (
          <>
          {matchingGroup && (
            <div className="note good">
              <strong>✅ AI 매칭 → 모임방 → 공개 게시글 생성 완료</strong>
              <br />
              추천 후보는 자동으로 참여하지 않아요. 댓글·참여 신청 후 입장 방식에 따라 채팅방에 들어와요.
              <div style={{ height: "10px" }} />
              {btn("생성된 커뮤니티 게시글 확인 →", `openGroup:${matchingGroup.id}`, "btn small green")}
            </div>
          )}
          <div className="section-head" style={{ marginTop: "10px" }}>
            <h2>추천 동행 후보</h2>
            {pill("가중치 적용 점수", "green")}
          </div>
          <p className="sm muted">
            {festival(state.matchFestivalId)?.name || f.name} 참가를 기준으로 계산한 <b>추천 점수</b>예요.
          </p>
          {candidates.length ? (
            <div className="result-grid">
              {candidates.map((o) => (
                <div className="match-result" key={o.id}>
                  <span className="avatar">{o.p.emoji}</span>
                  <div>
                    <strong>{o.p.name}</strong>
                    <div className="sm muted">
                      {o.p.style} · {o.p.interests.join(" · ")}
                    </div>
                    <ScoreWhy parts={o.parts} />
                    <details className="ratio-detail">
                      <summary>점수 상세 보기</summary>
                      <div className="ratio">
                        {Object.entries(o.parts).map(([k, v]) => (
                          <span key={k}>
                            {k} {v}
                          </span>
                        ))}
                      </div>
                    </details>
                    <div className="score-bar">
                      <div style={{ width: o.score + "%" }} />
                    </div>
                  </div>
                  <div className="score">
                    {o.score}
                    <small>%</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">추천 결과가 없어요.</div>
          )}
          <div className="note" style={{ marginTop: "15px" }}>
            추천 점수는 입력한 조건이 얼마나 겹치는지를 나타내요. 실제 만족도를 보장하지는 않아요.
          </div>
          </>
        ) : (
          <div className="match-idle">
            <div className="cand-head">
              <h2>추천 동행</h2>
            </div>
            <p className="cand-sub">챗봇 대화나 설정이 끝나면 잘 맞는 동행이 여기에 나타나요.</p>
            <ol className="how-steps path">
              {[
                ["ti-message-circle", "조건 말하기", "가고 싶은 축제와 원하는 동행을 편하게 말해요"],
                ["ti-help-circle", "빠진 조건 되묻기", "날짜·시간처럼 꼭 필요한 것만 AI가 다시 물어봐요"],
                ["ti-users", "동행 추천", "합류 시간과 취향이 잘 맞는 순서로 보여 드려요"],
              ].map(([icon, title, desc], i) => (
                <li key={title} className={i === 0 ? "now" : ""}>
                  <i className={`ti ${icon}`} aria-hidden="true" />
                  <div>
                    <small>
                      STEP {i + 1}
                      {i === 0 ? " · 지금" : ""}
                    </small>
                    <b>{title}</b>
                    <span>{desc}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
      </div>
    </>
  );
}

// 점수 요약: 잘 맞는 점(80% 이상)·다른 점(50% 미만)
function ScoreWhy({ parts }) {
  const r = Object.entries(parts)
    .filter(([, v]) => v !== "미선택")
    .map(([k, v]) => {
      const [a, b] = String(v).split("/").map(Number);
      return [k, a / b];
    });
  const good = r.filter((x) => x[1] >= 0.8).map((x) => x[0]);
  const weak = r.filter((x) => x[1] < 0.5).map((x) => x[0]);
  if (!good.length && !weak.length)
    return (
      <div className="why">
        <span className="g">전반적으로 무난하게 맞아요</span>
      </div>
    );
  return (
    <div className="why">
      {good.length > 0 && <span className="g">잘 맞는 점 · {good.slice(0, 3).join(", ")}</span>}
      {weak.length > 0 && <span className="w">다른 점 · {weak.slice(0, 2).join(", ")}</span>}
    </div>
  );
}

// 실제 API 매칭 결과 — v3: 후보 목록(합류 시각·공통점) + 「이 조건으로 모집할까요?」 박스
const REASON_ICON = (r) => (/합류|시/.test(r) ? "ti-clock" : /나이/.test(r) ? "ti-user" : /관심|취향/.test(r) ? "ti-heart" : /예산/.test(r) ? "ti-wallet" : /스타일/.test(r) ? "ti-walk" : "ti-check");
function ApiResults({ run, festival, profile, summary, pill, joinLabel }) {
  const head = (right) => (
    <div className="cand-head">
      <h2>
        추천 동행 {right != null && <span>{right}</span>}
      </h2>
    </div>
  );
  if (run.status === "loading")
    return (
      <>
        {head()}
        <div className="empty match-empty">
          <div className="big">⏳</div>
          <h3>잘 맞는 동행을 찾고 있어요</h3>
        </div>
      </>
    );
  if (run.status === "error")
    return (
      <>
        {head()}
        <div className="note">
          <strong>매칭하지 못했어요</strong>
          <br />
          {run.error}
        </div>
      </>
    );
  const candidates = run.result?.candidates || [];
  const date = run.conditions?.date || profile.date;
  const start = run.conditions?.startTime || profile.start;
  const party = run.partySize || profile.party;
  const dl = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return `${d.getMonth() + 1}.${d.getDate()} ${"일월화수목금토"[d.getDay()]}`;
  };
  return (
    <>
      {head(`${candidates.length}명`)}
      <p className="cand-sub">합류 시간과 관심사가 비슷한 순서예요.</p>
      {candidates.length ? (
        <div className="cand-list">
          {candidates.map((o) => (
            <div className="cand" key={o.id}>
              <span className="cand-ava">
                {o.avatarUrl ? <img src={o.avatarUrl} alt="" /> : (o.name || "?").slice(0, 1)}
              </span>
              <div className="cand-body">
                <div className="cand-top">
                  <b>{o.name}</b>
                  <span className="cand-pct">매칭 {o.score}%</span>
                </div>
                {o.reasons.map((r) => (
                  <div className="cand-meta" key={r}>
                    <i className={`ti ${REASON_ICON(r)}`} aria-hidden="true" /> {r}
                  </div>
                ))}
                <details className="ratio-detail">
                  <summary>점수 상세 보기</summary>
                  <div className="ratio">
                    {Object.entries(o.parts).map(([k, v]) => (
                      <span key={k}>
                        {k} {v}
                      </span>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">조건에 맞는 동행이 아직 없어요. 조건을 바꿔 다시 찾아보세요.</div>
      )}
      {candidates.length > 0 && (
        <div className="cta-box">
          <h3>이 조건으로 동행을 모집할까요? ✍️</h3>
          <p>확인한 조건을 바탕으로 모집글 초안을 만들어요.</p>
          <dl>
            <dt>방문 일정</dt>
            <dd>{date ? `${dl(date)}${start ? ` · ${start}` : ""}` : "미정"}</dd>
            <dt>모집 인원</dt>
            <dd>
              {party ? `나 포함 ${party}명` : "정원은 다음 단계에서 정해요"}
              {joinLabel ? ` · ${joinLabel}` : ""}
            </dd>
          </dl>
          <CreatePostBox
            cta
            festival={festival}
            runId={run.runId}
            partySize={party}
            joinMode={recruitmentJoinMode(run.runId, profile.joinMode)}
            summary={summary}
            date={date}
            startTime={start}
          />
          <div className="cta-foot">게시 전에 내용을 확인하고 수정할 수 있어요.</div>
        </div>
      )}
    </>
  );
}
