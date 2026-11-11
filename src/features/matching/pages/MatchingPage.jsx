import { Fragment } from "react";
import { useDemo } from "../../../app/DemoProvider.jsx";
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
  } = demo;
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
        "선호 조건을 입력하면 6개 요소로 점수를 계산하고, 공개 모임방과 커뮤니티 게시글을 자동 생성합니다.",
      )}

      <div className="workflow">
        <div className="step">
          <b>01</b>
          매칭 조건 입력
        </div>
        <div className="step">
          <b>02</b>
          AI 점수 계산
        </div>
        <div className="step">
          <b>03</b>
          모임방 생성
        </div>
        <div className="step">
          <b>04</b>
          공개 게시글 등록
        </div>
      </div>
      <div
        style={{
          height: "17px",
        }}
      />

      <div className="columns uneven">
        <section className="box pad">
          <h2
            style={{
              fontSize: "17px",
            }}
          >
            🎯 나의 여행 조건
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

          <div className="field">
            <label>선호 MBTI · 복수 선택 가능 (선택 사항)</label>
            <div className="chips">
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
              선택하지 않아도 됩니다. 미선택 시 MBTI 10%를 제외한 90% 가중치를
              100점 기준으로 환산합니다.
            </div>
          </div>

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
          {btn(
            "✨ AI 추천 + 모임방 자동 생성",
            "runMatch",
            "btn primary block",
          )}
        </section>

        <section className="box pad">
          {state.matchingDone && matchingGroup ? (
            <>
              <div className="note good">
                <strong>✅ AI 매칭 → 모임방 → 공개 게시글 생성 완료</strong>
                <br />
                추천 후보는 자동으로 참여하지 않습니다. 댓글·참여 신청 후 입장
                방식에 따라 채팅방에 들어옵니다.
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
            <h2>🤝 추천 동행 후보</h2>
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
                <b>데모 추천 점수</b>
                입니다.
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
                        <div className="ratio">
                          {Object.entries(o.parts).map(([k, v], index) => (
                            <Fragment key={index}>
                              <span>
                                {k} {v}
                              </span>
                            </Fragment>
                          ))}
                        </div>
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
                  <div className="empty">추천 결과가 없습니다.</div>
                </>
              )}
              <div
                className="note"
                style={{
                  marginTop: "15px",
                }}
              >
                점수는 MVP용 단순 규칙 계산입니다. 매칭 적합도·만족도를 실제로
                검증한 예측 확률이 아닙니다.
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
                  커뮤니티 모임이 생성됩니다.
                </p>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
