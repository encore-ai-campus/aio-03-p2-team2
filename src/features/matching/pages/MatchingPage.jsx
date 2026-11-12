import { Fragment } from "react";
import { useDemo } from "../../../app/DemoProvider.jsx";
import AiChatPanel from "../components/AiChatPanel.jsx";
import { AI_JOIN } from "../lib/aiParse.js";

const INTERESTS = ["미식", "사진", "산책", "음악", "문화", "전통", "자연", "카페", "액티비티"];
const MBTIS = [
  "ISTJ", "ISFJ", "INFJ", "INTJ", "ISTP", "ISFP", "INFP", "INTP",
  "ESTP", "ESFP", "ENFP", "ENTP", "ESTJ", "ESFJ", "ENFJ", "ENTJ",
];

// v4.4 · 왼쪽: 챗봇(메인) + 접힌 직접 조건 설정 / 오른쪽: 추천 동행 후보
export default function MatchingPage() {
  const demo = useDemo();
  const { state, btn, pill, fieldProps, festival, person, active, dateShort, pageHead, mutate } = demo;
  const f = festival(state.festivalId) || state.festivals.find(active) || state.festivals[0];
  const pr = state.profile;
  const all = state.festivals.filter(active);
  const candidates = state.matchingDone
    ? (state.matchScores || []).map((x) => ({ ...x, p: person(x.id) }))
    : [];
  const matchingGroup = state.groups.find(
    (g) => g.leader === state.actor && g.id === state.matchGroupId,
  );
  const chosen = state.festivalId ? festival(state.festivalId) : null;
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

      <ol className={`workflow ${state.matchingDone ? "done" : ""}`} aria-label="매칭 진행 단계">
        {["조건 말하기", "AI 점수 계산", "모임방 생성", "모집글 등록"].map((x, i) => (
          <li className="step" key={x}>
            <b>{state.matchingDone ? "✓" : i + 1}</b>
            {x}
          </li>
        ))}
      </ol>

      <div className="match-layout">
      <div className="match-main">
      <AiChatPanel />

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
            {btn("이 조건으로 매칭하기", "runMatch", "btn primary")}
            <p className="run-hint">
              챗봇에서 말한 조건도 여기에 반영돼요. 실행하면 공개 모집글과 모임방이 자동으로 만들어지고,
              추천된 사람이 자동으로 참여하지는 않아요.
            </p>
          </div>
        </div>
      </details>
      </div>

      <section className="box pad match-results">
        {state.matchingDone ? (
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
