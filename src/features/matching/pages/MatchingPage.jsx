import { Fragment, useState } from "react";
import { useDemo } from "../../../app/DemoProvider.jsx";
import AiChatPanel from "../components/AiChatPanel.jsx";
import AgentChatPanel from "../components/AgentChatPanel.jsx";
import { AI_JOIN } from "../lib/aiParse.js";
import { SOURCE_LABEL, useFestivals } from "../../festivals/hooks/useFestivals.js";
import { conditionKey, useMatchingRun } from "../hooks/useMatchingRun.js";
import CreatePostBox from "../../groups/components/CreatePostBox.jsx";

const INTERESTS = ["미식", "사진", "산책", "음악", "문화", "전통", "자연", "카페", "액티비티"];
const MBTIS = [
  "ISTJ", "ISFJ", "INFJ", "INTJ", "ISTP", "ISFP", "INFP", "INTP",
  "ESTP", "ESFP", "ENFP", "ENTP", "ESTJ", "ESFJ", "ENFJ", "ENTJ",
];

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
  const directResult = useApi && run.key === conditionKey(state.festivalId, pr) ? run : null;
  const apiResult = useApi ? agentRun || directResult : null;
  const showDemoResult = !useApi && state.matchingDone;
  const runApiMatch = () => {
    const missing = [
      !all.some((x) => x.id === state.festivalId) && "축제",
      !pr.start && "시작 시간",
      !pr.party && "희망 인원",
    ].filter(Boolean);
    if (missing.length) return setFormMsg(`필수 조건을 입력해 주세요: ${missing.join(", ")}`);
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

  const setFormOpen = (open) =>
    mutate((s) => {
      s.formOpen = open;
    });

  return (
    <>
      {pageHead(
        "AI TRAVEL MATCHING",
        "💞 AI 동행 매칭",
        "가고 싶은 축제와 원하는 동행을 말로 적으면 AI가 조건을 정리해 추천하고, 공개 모집글과 모임방을 만들어요.",
      )}

      {/* 실서버 모드: 실제 진행한 단계까지만 ✓ (후보 추천까지 = 2단계, 모집글·신청은 다음 화면) */}
      {useApi ? (
        <ol className="workflow" aria-label="매칭 진행 단계">
          {["조건 말하기", "AI 후보 추천", "모집글 만들기", "참여 신청·승인"].map((x, i) => {
            const done = apiResult?.status === "done" && i < 2;
            return (
              <li className="step" key={x}>
                <b style={done ? { background: "var(--coral)", color: "#fff" } : undefined}>{done ? "✓" : i + 1}</b>
                {x}
              </li>
            );
          })}
        </ol>
      ) : (
      <ol className={`workflow ${showDemoResult ? "done" : ""}`} aria-label="매칭 진행 단계">
        {["조건 말하기", "AI 점수 계산", "모임방 생성", "모집글 등록"].map((x, i) => (
          <li className="step" key={x}>
            <b>{showDemoResult ? "✓" : i + 1}</b>
            {x}
          </li>
        ))}
      </ol>
      )}

      <div className="match-layout">
      <div className="match-main">
      {useApi ? (
        <AgentChatPanel
          festivals={all}
          festivalId={state.festivalId}
          pill={pill}
          onResult={setAgentRun}
          onPickFestival={(id) =>
            mutate((s) => {
              s.festivalId = id;
              s.matchingDone = false;
            })
          }
        />
      ) : (
        <AiChatPanel />
      )}

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
          <span className="form-fold-sum">{summary}</span>
          <span className="form-fold-cta">{state.formOpen ? "접기" : "수정"}</span>
        </summary>
        <div className="form-body">
          <div className="field">
            <label htmlFor="match-festival">참여할 축제 *</label>
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
            <label htmlFor="match-style">여행 스타일</label>
            <select id="match-style" {...fieldProps("match-style")}>
              <option value="">상관없음</option>
              {["여유롭게", "활동적으로", "계획적으로"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="match-start">참여 가능 시작 *</label>
            <input id="match-start" type="time" {...fieldProps("match-start")} />
          </div>
          <div className="field">
            <label htmlFor="match-budget">여행 예산 (만원)</label>
            <select id="match-budget" {...fieldProps("match-budget")}>
              <option value="">상관없음</option>
              {[3, 5, 7, 8, 10, 12, 15, 20].map((v) => (
                <option key={v} value={v}>
                  {v}만원
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="match-cap">희망 모임 정원 *</label>
            <select id="match-cap" {...fieldProps("match-cap")}>
              <option value="">선택</option>
              {[2, 3, 4, 5, 6, 7, 8].map((x) => (
                <option key={x} value={x}>
                  {x}명
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="match-joinmode">채팅방 입장 방식</label>
            <select id="match-joinmode" {...fieldProps("match-joinmode")}>
              <option value="approval">모임장 승인제</option>
              <option value="instant">즉시 참여제</option>
            </select>
          </div>
          <div className="field span-2">
            <label>관심사 · 복수 선택</label>
            <div className="chips">
              {INTERESTS.map((x) => (
                <Fragment key={x}>
                  {btn(x, `interest:${x}`, `chip ${pr.interests.includes(x) ? "active" : ""}`)}
                </Fragment>
              ))}
            </div>
          </div>
          <details
            className="field fold span-2"
            open={!!state.mbtiOpen}
            onToggle={(e) => {
              const open = e.currentTarget.open;
              if (open !== !!state.mbtiOpen)
                mutate((s) => {
                  s.mbtiOpen = open;
                });
            }}
          >
            <summary>
              선호 MBTI{" "}
              <span className="muted" style={{ fontWeight: 650 }}>
                (선택) · {pr.mbti.length ? pr.mbti.join(", ") : "상관없음"}
              </span>
            </summary>
            <div className="chips" style={{ marginTop: "10px" }}>
              {MBTIS.map((x) => (
                <Fragment key={x}>
                  {btn(x, `mbti:${x}`, `chip ${pr.mbti.includes(x) ? "active" : ""}`)}
                </Fragment>
              ))}
            </div>
            <div className="hint">
              선택하지 않아도 돼요. 미선택 시 MBTI 10%를 제외한 90% 가중치를 100점 기준으로 환산해요.
            </div>
          </details>
          <div className="note span-2">
            <strong>* 필수</strong> · 축제·시작 시간·희망 인원이 있어야 매칭해요. 선택 조건(예산·관심사·여행
            스타일·MBTI)을 비워 두면 그 항목은 점수에서 빼고 100점 기준으로 환산해요.
            <br />
            <strong>매칭 가중치</strong> · 일정 25% · 관심사 20% · 예산 20% · 여행 스타일 15% · MBTI 10% ·
            희망 동행 인원 10%
          </div>
          <div className="span-2 form-run">
            {useApi ? (
              <button type="button" className="btn primary" disabled={run.status === "loading"} onClick={runApiMatch}>
                {run.status === "loading" ? "매칭 중…" : "이 조건으로 매칭하기"}
              </button>
            ) : (
              btn("이 조건으로 매칭하기", "runMatch", "btn primary")
            )}
            <span className={sourceClass} style={{ marginLeft: "8px" }}>{sourceText}</span>
            {formMsg && <p className="run-hint" role="alert"><strong>{formMsg}</strong></p>}
            <p className="run-hint">
              {useApi
                ? "실제 서버에서 추천 점수를 계산해요. 모집글·모임방 생성은 다음 단계에서 연결돼요."
                : "챗봇에서 말한 조건도 여기에 반영돼요. 실행하면 공개 모집글과 모임방이 자동으로 만들어지고, 추천된 사람이 자동으로 참여하지는 않아요."}
            </p>
          </div>
        </div>
      </details>
      </div>

      <section className="box pad match-results">
        {apiResult ? (
          <ApiResults run={apiResult} festival={findFestival(state.festivalId)} profile={pr} summary={summary} pill={pill} />
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
          <>
            <div className="section-head" style={{ marginTop: 0 }}>
              <h2>추천 동행 후보</h2>
              {pill("매칭 대기", "blue")}
            </div>
            <div className="empty match-empty">
              <div className="big">💖</div>
              <h3>나와 잘 맞는 여행 동행을 찾아보세요</h3>
              <p>왼쪽 AI 매칭 도우미에 가고 싶은 축제와 원하는 동행을 말해 주세요. 매칭하면 추천 후보가 여기에 표시돼요.</p>
            </div>
          </>
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

// 실제 API 매칭 결과 (POST /matching/runs) — 데모 결과와 같은 카드 모양
function ApiResults({ run, festival, profile, summary, pill }) {
  const festivalName = festival?.name;
  const head = (label, tone) => (
    <div className="section-head" style={{ marginTop: 0 }}>
      <h2>추천 동행 후보</h2>
      {pill(label, tone)}
    </div>
  );
  if (run.status === "loading")
    return (
      <>
        {head("계산 중", "blue")}
        <div className="empty match-empty">
          <div className="big">⏳</div>
          <h3>추천 점수를 계산하고 있어요</h3>
        </div>
      </>
    );
  if (run.status === "error")
    return (
      <>
        {head("오류", "blue")}
        <div className="note">
          <strong>매칭하지 못했어요</strong>
          <br />
          {run.error}
        </div>
      </>
    );
  const candidates = run.result?.candidates || [];
  return (
    <>
      {head("가중치 적용 점수", "green")}
      <p className="sm muted">
        {festivalName || "선택한 축제"} 참가를 기준으로 계산한 <b>추천 점수</b>예요.
      </p>
      {candidates.length ? (
        <div className="result-grid">
          {candidates.map((o) => (
            <div className="match-result" key={o.id}>
              <span className="avatar">
                {o.avatarUrl ? <img src={o.avatarUrl} alt="" width="100%" height="100%" style={{ borderRadius: "50%", objectFit: "cover" }} /> : (o.name || "?").slice(0, 1)}
              </span>
              <div>
                <strong>{o.name}</strong>
                {o.reasons.length > 0 && <div className="sm muted">{o.reasons.join(" · ")}</div>}
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
        <div className="empty">조건에 맞는 추천 후보가 아직 없어요.</div>
      )}
      <div style={{ marginTop: "12px" }}>
        <CreatePostBox festival={festival} partySize={profile.party} joinMode={profile.joinMode || "approval"} summary={summary} />
      </div>
      <div className="note" style={{ marginTop: "15px" }}>
        추천 점수는 입력한 조건이 얼마나 겹치는지를 나타내요. 실제 만족도를 보장하지는 않아요.
      </div>
    </>
  );
}
