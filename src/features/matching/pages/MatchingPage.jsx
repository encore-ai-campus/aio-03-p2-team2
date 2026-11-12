import { Fragment, useEffect, useRef, useState } from "react";
import { useDemo } from "../../../app/DemoProvider.jsx";
import AiEntry from "../components/AiEntry.jsx";
import AiChatPanel from "../components/AiChatPanel.jsx";
export default function MatchingPage() {
  const demo = useDemo();
  const {
    state,
    btn,
    pill,
    fieldProps,
    festival,
    person,
    active,
    dateShort,
    pageHead,
    mutate,
  } = demo;
  const entryRef = useRef(null);
  const [entryVisible, setEntryVisible] = useState(true);
  useEffect(() => {
    const el = entryRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setEntryVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const openAi = () =>
    mutate((s) => {
      s.aiChat.open = true;
    });
  const f =
      festival(state.festivalId) ||
      state.festivals.find(active) ||
      state.festivals[0],
    pr = state.profile;
  const all = state.festivals.filter(active);
  const cb = [
    "미식",
    "사진",
    "산책",
    "음악",
    "문화",
    "전통",
    "자연",
    "카페",
    "액티비티",
  ];
  const mbtis = [
    "ISTJ",
    "ISFJ",
    "INFJ",
    "INTJ",
    "ISTP",
    "ISFP",
    "INFP",
    "INTP",
    "ESTP",
    "ESFP",
    "ENFP",
    "ENTP",
    "ESTJ",
    "ESFJ",
    "ENFJ",
    "ENTJ",
  ];
  const candidates = state.matchingDone
    ? (state.matchScores || []).map((x) => ({
        ...x,
        p: person(x.id),
      }))
    : [];
  let matchingGroup = state.groups.find(
    (g) => g.leader === state.actor && g.id === state.matchGroupId,
  );
  return (
    <>
      {pageHead(
        "AI TRAVEL MATCHING",
        "💞 AI 동행 매칭",
        "선호 조건을 입력하면 6개 요소로 점수를 계산하고, 공개 모임방과 커뮤니티 게시글을 자동 생성해요.",
      )}

      <ol className={`workflow ${state.matchingDone ? "done" : ""}`} aria-label="매칭 진행 단계">
        {["조건 입력", "AI 점수 계산", "모임방 생성", "모집글 등록"].map((x, i) => (
          <li className="step" key={x}>
            <b>{state.matchingDone ? "✓" : i + 1}</b>
            {x}
          </li>
        ))}
      </ol>
      <AiEntry ref={entryRef} onOpen={openAi} />

      <div className="columns uneven">
        <section className="box pad match-form">
          <h2
            style={{
              fontSize: "17px",
            }}
          >
            나의 여행 조건
          </h2>
          <div className="field">
            <label htmlFor="match-festival">참여할 축제</label>
            <select id="match-festival" {...fieldProps("match-festival")}>
              {all.map((x, index) => (
                <Fragment key={index}>
                  <option value={x.id}>
                    {x.name}
                    {" · "}
                    {dateShort(x.start)}
                  </option>
                </Fragment>
              ))}
            </select>
          </div>

          <div className="two">
            <div className="field">
              <label htmlFor="match-start">참여 가능 시작</label>
              <input
                id="match-start"
                type="time"
                {...fieldProps("match-start")}
              />
            </div>
            <div className="field">
              <label htmlFor="match-budget">여행 예산 (만원)</label>
              <select id="match-budget" {...fieldProps("match-budget")}>
                {[3, 5, 7, 8, 10, 12, 15, 20].map((v, index) => (
                  <Fragment key={index}>
                    <option value={v}>
                      {v}
                      만원
                    </option>
                  </Fragment>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>관심사 · 복수 선택</label>
            <div className="chips">
              {cb.map((x, index) => (
                <Fragment key={index}>
                  {btn(
                    x,
                    `interest:${x}`,
                    `chip ${pr.interests.includes(x) ? "active" : ""}`,
                  )}
                </Fragment>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="match-style">여행 스타일</label>
            <select id="match-style" {...fieldProps("match-style")}>
              {["여유롭게", "활동적으로", "계획적으로"].map((x, index) => (
                <Fragment key={index}>
                  <option>{x}</option>
                </Fragment>
              ))}
            </select>
          </div>

          <details
            className="field fold"
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
              {mbtis.map((x, index) => (
                <Fragment key={index}>
                  {btn(
                    x,
                    `mbti:${x}`,
                    `chip ${pr.mbti.includes(x) ? "active" : ""}`,
                  )}
                </Fragment>
              ))}
            </div>
            <div className="hint">
              선택하지 않아도 돼요. 미선택 시 MBTI 10%를 제외한 90% 가중치를
              100점 기준으로 환산해요.
            </div>
          </details>

          <div className="two">
            <div className="field">
              <label htmlFor="match-cap">희망 모임 정원</label>
              <select id="match-cap" {...fieldProps("match-cap")}>
                {[2, 3, 4, 5, 6, 7, 8].map((x, index) => (
                  <Fragment key={index}>
                    <option value={x}>{x}명</option>
                  </Fragment>
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
          </div>

          <div className="note">
            <strong>초기 매칭 가중치</strong>
            <br />
            일정 25% · 관심사 20% · 예산 20% · 여행 스타일 15% · MBTI 10% · 희망
            동행 인원 10%
          </div>
          <div
            style={{
              height: "13px",
            }}
          />
          {btn("AI 추천 받고 모임 만들기", "runMatch", "btn primary block")}
          <p className="run-hint">
            실행하면 공개 모집글과 모임방이 자동으로 만들어져요. 추천된 사람이
            자동으로 참여하지는 않아요.
          </p>
        </section>

        <section className="box pad match-results">
          {state.matchingDone && matchingGroup ? (
            <>
              <div className="note good">
                <strong>✅ AI 매칭 → 모임방 → 공개 게시글 생성 완료</strong>
                <br />
                추천 후보는 자동으로 참여하지 않아요. 댓글·참여 신청 후 입장
                방식에 따라 채팅방에 들어와요.
                <div
                  style={{
                    height: "10px",
                  }}
                />
                {btn(
                  "생성된 커뮤니티 게시글 확인 →",
                  `openGroup:${matchingGroup.id}`,
                  "btn small green",
                )}
              </div>
            </>
          ) : (
            ""
          )}
          <div
            className="section-head"
            style={{
              marginTop: "10px",
            }}
          >
            <h2>추천 동행 후보</h2>
            {pill(
              state.matchingDone ? "가중치 적용 점수" : "매칭 대기",
              state.matchingDone ? "green" : "blue",
            )}
          </div>

          {state.matchingDone ? (
            <>
              <p className="sm muted">
                {festival(state.matchFestivalId)?.name || f.name}
                {" 참가를 기준으로 계산한 "}
                <b>추천 점수</b>
                예요.
              </p>
              {candidates.length ? (
                candidates.map((o, index) => (
                  <Fragment key={index}>
                    <div className="match-result">
                      <span className="avatar">{o.p.emoji}</span>
                      <div>
                        <strong>{o.p.name}</strong>
                        <div className="sm muted">
                          {o.p.style}
                          {" · "}
                          {o.p.interests.join(" · ")}
                        </div>
                        <ScoreWhy parts={o.parts} />
                        <details className="ratio-detail">
                          <summary>점수 상세 보기</summary>
                          <div className="ratio">
                            {Object.entries(o.parts).map(([k, v], index) => (
                              <Fragment key={index}>
                                <span>
                                  {k} {v}
                                </span>
                              </Fragment>
                            ))}
                          </div>
                        </details>
                        <div className="score-bar">
                          <div
                            style={{
                              width: "" + o.score + "%",
                            }}
                          />
                        </div>
                      </div>
                      <div className="score">
                        {o.score}
                        <small>%</small>
                      </div>
                    </div>
                  </Fragment>
                ))
              ) : (
                <>
                  <div className="empty">추천 결과가 없어요.</div>
                </>
              )}
              <div
                className="note"
                style={{
                  marginTop: "15px",
                }}
              >
                추천 점수는 입력한 조건이 얼마나 겹치는지를 나타내요. 실제
                만족도를 보장하지는 않아요.
              </div>
            </>
          ) : (
            <>
              <div
                className="empty"
                style={{
                  minHeight: "365px",
                  display: "grid",
                  placeContent: "center",
                }}
              >
                <div className="big">💖</div>
                <h3>나와 잘 맞는 여행 동행을 찾아보세요</h3>
                <p>
                  왼쪽에서 선호 조건을 설정하고 AI 매칭을 실행하세요. 실제로
                  커뮤니티 모임이 생성돼요.
                </p>
              </div>
            </>
          )}
        </section>
      </div>
      <AiChatPanel showFab={!entryVisible} />
    </>
  );
}

// v4.3 · 점수 요약: 잘 맞는 점(80% 이상)·다른 점(50% 미만)
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
