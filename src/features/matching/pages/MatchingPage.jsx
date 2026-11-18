import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { useAppState } from "../../../app/AppStateProvider.jsx";
import AgentChatPanel from "../components/AgentChatPanel.jsx";
import { AI_JOIN } from "../lib/matchingConditions.js";
import { recruitmentJoinMode } from "../lib/matchingConditions.js";
import { matchingView, selectedApiFestival } from "../lib/agentFestival.js";
import { useFestivals } from "../../festivals/hooks/useFestivals.js";
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
  const ui = useAppState();
  const { state, btn, pill, fieldProps, active, dateShort, mutate } = ui;
  const pr = state.profile;
  // 축제 탐색과 동일한 실제 API 목록만 사용한다.
  const { festivals: liveFestivals, source } = useFestivals();
  const useApi = source === "api";
  const findFestival = (id) => selectedApiFestival(liveFestivals, id);
  const isOpen = (x) => (x.apiStatus ? x.apiStatus !== "past" && x.riskStatus !== "cancelled" : active(x));
  const all = liveFestivals.filter(isOpen);
  const apiFestival = useApi ? selectedApiFestival(all, state.festivalId) : undefined;
  useEffect(() => {
    if (!useApi || !state.festivalId || apiFestival) return;
    mutate((s) => {
      s.festivalId = null;
    });
  }, [useApi, state.festivalId, apiFestival, mutate]);
  // 직접 조건 매칭(실제 API) — 조건이 바뀌면 이전 결과는 숨긴다
  const { run, execute } = useMatchingRun();
  const [formMsg, setFormMsg] = useState("");
  // 오른쪽 패널 결과: 챗봇(에이전트) 결과가 있으면 우선, 없으면 직접 조건 매칭 결과
  const [agentRun, setAgentRun] = useState(null);
  // 실서버 모드: 왼쪽 카드 탭 (챗봇으로 찾기 / 직접 설정하기)
  const [tab, setTab] = useState("chat");
  const [optOpen, setOptOpen] = useState(false);
  // 결과의 「조건 더하기」: 직접 설정하기로 넘어가며 선택 조건을 펼쳐 보여 준다
  const openMore = () => {
    setTab("form");
    setOptOpen(true);
    requestAnimationFrame(() =>
      document.querySelector(".mp-v3 .tab-form .opt-fold")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const [chatStage, setChatStage] = useState(0); // 챗봇 진행 단계 → 오른쪽 STEP 안내 (0 조건 말하기 · 1 되묻기 · 2 추천)
  const directResult = useApi && run.key === conditionKey(state.festivalId, pr) ? run : null;
  const apiResult = useApi ? agentRun || directResult : null;
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

  // 직접 조건 설정 폼
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
                <span>합류 시간 20%</span>
                <span>관심사 20%</span>
                <span>예산 15%</span>
                <span>여행 스타일 15%</span>
                <span>연령대 10%</span>
                <span>희망 인원 10%</span>
                <span>성별 5%</span>
                <span>MBTI 5%</span>
              </div>
              <p>선택 조건을 비워 두면 그 항목은 빼고 나머지로 100점 기준을 다시 계산해요. 60% 이상인 동행을 추천해요.</p>
            </details>
            <button type="button" className="btn primary" disabled={run.status === "loading"} onClick={runApiMatch}>
              {run.status === "loading" ? "매칭 중…" : "이 조건으로 매칭하기"}
            </button>
            {formMsg && <p className="run-hint" role="alert"><strong>{formMsg}</strong></p>}
          </div>

          {/* 선택 조건: 기본 접힘 · 한 줄에 한 항목(왼쪽 소제목 / 오른쪽 선택) */}
          <details
            className="opt-fold"
            open={optOpen}
            onToggle={(e) => {
              const open = e.currentTarget.open;
              if (open !== optOpen) setOptOpen(open);
            }}
          >
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

  // 불러오는 중·조회 실패·빈 목록을 구분해 안내한다.
  const view = matchingView(source);
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
                  {pr.date ? ` · ${dayLabel(pr.date)}${pr.start ? ` ${pr.start}` : ""}` : ""}
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
          festivals={all}
          festivalId={apiFestival?.id}
          selectedDate={chosen && pr.date >= chosen.start && pr.date <= chosen.end ? pr.date : undefined}
          pill={pill}
          onResult={setAgentRun}
          onStage={setChatStage}
          onEditConditions={() => setTab("form")}
          onPickFestival={(id) =>
            mutate((s) => {
              s.festivalId = id;
                    })
          }
        />
          </div>
          <div className="tab-form" hidden={tab !== "form"}>
            {formBody}
          </div>
        </div>
        </div>
        <section className={`box pad match-results${apiResult ? " has-result" : ""}`}>
          {apiResult ? (<ApiResults key={apiResult.runId || apiResult.key} run={apiResult} festival={findFestival(state.festivalId)} profile={pr} summary={postSummary} joinLabel={AI_JOIN[recruitmentJoinMode(agentRun, pr.joinMode)]} onEdit={openMore} />) : (
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

// 실제 API 매칭 결과 — v3: 후보 목록(합류 시각·공통점) + 「이 조건으로 모집할까요?」 박스
const REASON_ICON = (r) => (/합류|시/.test(r) ? "ti-clock" : /나이/.test(r) ? "ti-user" : /관심|취향/.test(r) ? "ti-heart" : /예산/.test(r) ? "ti-wallet" : /스타일/.test(r) ? "ti-walk" : "ti-check");
function ApiResults({ run, festival, profile, summary, joinLabel, onEdit }) {
  const [picked, setPicked] = useState([]); // 함께하고 싶은 동행 id (모집글 초안에 들어감)
  const [saving, setSaving] = useState(false);
  if (run.status === "loading")
    return (
      <div className="ws-body ws-pad">
        <div className="ws-title"><h2>추천 동행</h2></div>
        <div className="cand-skel" aria-busy="true" aria-label="잘 맞는 동행을 찾는 중">
          {[0, 1, 2].map((i) => <span key={i} />)}
        </div>
      </div>
    );
  if (run.status === "error")
    return (
      <div className="ws-body ws-pad">
        <div className="ws-title"><h2>추천 동행</h2></div>
        <div className="note"><strong>매칭하지 못했어요</strong><br />{run.error}</div>
      </div>
    );
  const candidates = run.result?.candidates || [];
  const date = run.conditions?.date || profile.date;
  const start = run.conditions?.startTime || profile.start;
  const party = Number(run.partySize || profile.party) || 2;
  const max = Math.max(party - 1, 1); // 나를 뺀 모집 인원까지 고를 수 있음
  const dl = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return `${d.getMonth() + 1}.${d.getDate()}(${"일월화수목금토"[d.getDay()]})`;
  };
  if (!candidates.length)
    return (
      <div className="ws-body ws-pad">
        <div className="ws-title"><h2>추천 동행 <span>0명</span></h2></div>
        <div className="cand-none">
          <i className="ti ti-user-search" aria-hidden="true" />
          <h3>이 조건에 맞는 동행이 아직 없어요</h3>
          <p>
            {[date && dl(date), start && `${start} 시작`].filter(Boolean).join(" · ") || "지금 조건"}으로는 잘 맞는 동행을 찾지 못했어요.
            <br />
            조건을 바꿔 보거나, 모집글을 먼저 올려 동행을 기다려 보세요.
          </p>
          <div className="cand-none-actions">
            {onEdit && (
              <button type="button" className="cand-none-btn" onClick={onEdit}>
                <i className="ti ti-adjustments-horizontal" aria-hidden="true" /> 조건 바꾸기
              </button>
            )}
            <Link to="/groups" className="cand-none-btn primary">
              <i className="ti ti-pencil-plus" aria-hidden="true" /> 커뮤니티에 모집글 올리기
            </Link>
          </div>
        </div>
      </div>
    );
  const toggle = (id) =>
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (max === 1) return [id]; // 1명 모집이면 선택이 옮겨감
      return cur.length < max ? [...cur, id] : cur; // 여러 명이면 최대 수까지 중복 선택
    });
  const full = max > 1 && picked.length >= max;
  const names = candidates.filter((o) => picked.includes(o.id)).map((o) => o.name);
  return (
    <>
      <div className="ws-head">
        <div className="ws-title">
          <h2>추천 동행 <span>{candidates.length}명</span></h2>
          <div className="pick-count">선택 <b>{picked.length}</b> / {max}명</div>
        </div>
        <p>함께하고 싶은 동행을 골라 주세요. 모집글에 함께 담겨요.</p>
      </div>
      <div className="ws-body">
        <div className="pick-list" role="group" aria-label="추천 동행 선택">
          {candidates.map((o) => {
            const on = picked.includes(o.id);
            return (
              <button
                type="button"
                key={o.id}
                role="checkbox"
                aria-checked={on}
                disabled={saving}
                className={`pick-card${full && !on ? " dim" : ""}`}
                onClick={() => toggle(o.id)}
              >
                <span className="pick-ava">{o.avatarUrl ? <img src={o.avatarUrl} alt="" /> : (o.name || "?").slice(0, 1)}</span>
                <span className="pick-body">
                  <span className="pick-name">
                    <b>{o.name}</b>
                    {o.profile?.availableFrom && (
                      <span className="pick-time" title={`${o.profile.availableFrom}부터 합류 가능`}>
                        <i className="ti ti-clock" aria-hidden="true" />
                        {String(o.profile.availableFrom).slice(0, 5)}~
                      </span>
                    )}
                  </span>
                  <span className="pick-tags">
                    {candidateTags(o, profile).map(([icon, text, hit]) => (
                      <span className={`pick-tag${hit ? " hit" : ""}`} key={text}>
                        <i className={`ti ${icon}`} aria-hidden="true" />
                        {text}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="pick-box" aria-hidden="true"><i className="ti ti-check" /></span>
              </button>
            );
          })}
        </div>
        {full && <p className="pick-limit">최대 {max}명까지 고를 수 있어요</p>}
        {onEdit && (
          <div className="pick-tip">
            <i className="ti ti-sparkles" aria-hidden="true" />
            <div>
              <b>더 잘 맞는 동행을 찾고 싶다면</b>
              <span>관심사·스타일·예산을 더하면 더 정확해져요</span>
            </div>
            <button type="button" onClick={onEdit} disabled={saving}>조건 더하기 <i className="ti ti-chevron-right" aria-hidden="true" /></button>
          </div>
        )}
      </div>
      <div className="ws-foot pick-foot">
        <div className="pick-info">
          <div>
            <span className="k">일정</span> {date ? `${dl(date)} ${start || ""}` : "미정"} · <span className="k">모집</span> 나 포함 {party}명{joinLabel ? ` · ${joinLabel}` : ""}
          </div>
          <div>
            <span className="k">함께할 동행</span> {names.length ? <b>{names.join(", ")}</b> : "아직 고르지 않았어요"}
          </div>
        </div>
        <CreatePostBox
          cta
          festival={festival}
          runId={run.runId}
          partySize={party}
          joinMode={recruitmentJoinMode(run.runId, profile.joinMode)}
          summary={summary}
          selectedCompanions={names}
          onBusyChange={setSaving}
          date={date}
          startTime={start}
        />
      </div>
    </>
  );
}

// 후보 카드 태그: 프로필 요약(합류 시각·연령대·여행 스타일·관심사) — 내 조건과 겹치는 값은 강조
function candidateTags(o, mine = {}) {
  const p = o.profile || {};
  const text = (o.reasons || []).join(" ");
  const hitInterests = (text.match(/관심사 \d+개 일치\(([^)]*)\)/)?.[1] || "").split(",").map((x) => x.trim()).filter(Boolean);
  const tags = [];
  if (p.ageBand) tags.push(["ti-user", p.ageBand, /같은 나이대/.test(text)]);
  // 강조 기준: 이번 검색 조건과 겹침(추천 이유) 또는 내 프로필(온보딩 선호)과 같음
  if (p.travelStyle) tags.push(["ti-route", p.travelStyle, /여행 스타일 같음/.test(text) || (!!mine.style && (String(mine.style).includes(p.travelStyle) || p.travelStyle.includes(mine.style)))]);
  // 관심사는 한 태그로 묶어 줄바꿈을 줄임 (예: 음악 · 미식)
  const ints = (p.interests || []).slice(0, 2);
  const myInts = mine.interests || [];
  if (ints.length) tags.push(["ti-heart", ints.join(" · "), ints.some((x) => hitInterests.includes(x) || myInts.includes(x))]);
  if (!tags.length) (o.reasons || []).forEach((r) => tags.push([REASON_ICON(r), r, true]));
  return tags;
}
