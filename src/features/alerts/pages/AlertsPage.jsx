import { Fragment } from "react";
import { Button } from "../../../shared/components/Primitives.jsx";
import { useDemo } from "../../../app/DemoProvider.jsx";
export default function AlertsPage() {
  const demo = useDemo();
  const {
    state,
    btn,
    pill,
    fieldProps,
    dispatch,
    festival,
    active,
    statusPill,
    period,
    alternativeFestivals,
    pageHead,
  } = demo;
  let w = state.weather,
    ref = festival(w.festivalId) || festival("f22"),
    options = alternativeFestivals(ref);
  return (
    <>
      {pageHead(
        "AI RISK MONITOR & FALLBACK",
        "🔔 AI 알림·대체 축제",
        "악천후·취소·외부 변경 상황에서 사용자 의사를 먼저 확인하고 대안을 안내해요.",
      )}

      <div
        className="two"
        style={{
          marginTop: "16px",
        }}
      >
        <div className="box pad demo-card">
          <span className="demo-tag">데모 시나리오</span>
          <h2>위험 상황 만들어 보기</h2>
          <p className="sm muted">
            실제 서비스에서는 기상청·축제 운영기관 정보로 자동 감지돼요. 시연을 위해 상황을 직접 만들 수 있어요.
          </p>
          <div className="field">
            <label htmlFor="weather-festival">영향을 받을 축제</label>
            <select id="weather-festival" {...fieldProps("weather-festival")}>
              {state.festivals.filter(active).map((f, index) => (
                <Fragment key={index}>
                  <option value={f.id}>{f.name}</option>
                </Fragment>
              ))}
            </select>
          </div>
          <div className="btnrow">
            {btn("☔ 강수 예보 발생", "simulate:rain", "btn primary")}
            {btn("🚫 축제 취소·변경 발생", "simulate:cancel", "btn")}
          </div>
          <div className="divider" />
          <h3>AI 알림 처리 순서</h3>
          <div
            className="how"
            style={{
              gridTemplateColumns: "1fr 1fr",
            }}
          >
            <div>
              <b>01 WATCH</b>
              <p>변경사항 감지</p>
            </div>
            <div>
              <b>02 ANALYZE</b>
              <p>참여 차질 판단</p>
            </div>
            <div>
              <b>03 ASK</b>
              <p>참여 의사 확인</p>
            </div>
            <div>
              <b>04 SUGGEST</b>
              <p>대체 축제 안내</p>
            </div>
          </div>
        </div>

        <div className="alert-panel">
          <span
            className="pill white"
            style={{
              background: "#65708c",
            }}
          >
            AI 알림 센터
          </span>
          {!w.type ? (
            <>
              <div
                style={{
                  marginTop: "23px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "58px",
                  }}
                >
                  🌤️
                </div>
                <h2>현재 시연 중인 위험 알림이 없어요</h2>
                <p className="sm muted">
                  왼쪽에서 비 예보 또는 축제 취소를 선택하면 확인 질문과 대안을
                  볼 수 있어요.
                </p>
              </div>
            </>
          ) : w.type === "rain" ? (
            <>
              <h2
                style={{
                  marginTop: "18px",
                }}
              >
                강수 예보가 감지되었어요
              </h2>
              <p className="sm">
                {ref.name}
                {" 방문에 비가 영향을 줄 수 있어요. "}
                <b>“비 예보 시 괜찮으세요?”</b>
                {" 계속 참여하시겠어요?"}
              </p>
              <div className="btnrow">
                {btn(
                  "네, 예정대로 참여할게요",
                  "weatherAnswer:yes",
                  "btn green",
                )}
                {btn(
                  "아니요, 다른 축제 추천해 주세요",
                  "weatherAnswer:no",
                  "btn primary",
                )}
              </div>
              {w.choice === "yes" ? (
                <>
                  <div
                    className="note good"
                    style={{
                      marginTop: "14px",
                    }}
                  >
                    참여 유지 의사를 확인했어요. 변경된 실제 예보가 생기면
                    추가 확인하도록 설계해요.
                  </div>
                </>
              ) : (
                ""
              )}
            </>
          ) : (
            <>
              <h2
                style={{
                  marginTop: "18px",
                }}
              >
                축제 일정 변경·취소 상황
              </h2>
              <p className="sm">
                {ref.name}
                {" 운영에 차질이 생겼다는 "}
                <b>가상 시나리오</b>
                예요. 기존 모임은 자동 취소하지 않고 대체 축제를 안내해요.
              </p>
              {btn("가능한 다른 축제 보기", "weatherAnswer:no", "btn primary")}
            </>
          )}
        </div>
      </div>

      {w.type && w.choice === "no" ? (
        <>
          <div className="section-head">
            <div>
              <h2>AI 대체 축제 추천</h2>
              <p>같은 유형·지역·관심 태그를 우선 반영한 규칙 기반 후보</p>
            </div>
            {pill("모임 변경은 사용자·모임장 확인 필요", "purple")}
          </div>
          <div className="alt-grid">
            {options.map((f, index) => (
              <Fragment key={index}>
                <Button
                  className="alt-choice"
                  data-action={"" + "chooseAlternative:" + f.id}
                  onClick={(event) => {
                    dispatch("" + "chooseAlternative:" + f.id);
                  }}
                >
                  <span className="icon">{f.emoji}</span>
                  <strong>{f.name}</strong>
                  <div className="metadata">
                    {f.region}
                    {" · "}
                    {period(f)}
                  </div>
                  <div
                    style={{
                      marginTop: "10px",
                    }}
                  >
                    {statusPill(f)}
                  </div>
                  <p
                    className="source-note"
                    style={{
                      marginTop: "9px",
                    }}
                  >
                    선택하면 해당 축제 AI 매칭으로 이동
                  </p>
                </Button>
              </Fragment>
            ))}
          </div>
        </>
      ) : (
        ""
      )}
    </>
  );
}
