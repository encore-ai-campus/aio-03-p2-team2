import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAlerts } from "../hooks/useAlerts.js";
import { formatAlertDate } from "../lib/alertDates.js";
import AlertForecast from "./AlertForecast.jsx";
import AlertWorkflowPanel from "./AlertWorkflowPanel.jsx";

const STEPS = ["날씨 확인", "진행 여부", "대체 축제", "일정 확정"];

export default function LiveAlerts({ festivals, onFail }) {
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const {
    loading, memberAlerts, myGroups, selectedGroupId, detail, schedule, selectedFestival, items, day, startTime, endTime,
    forecast, forecastStatus, weatherPrompt, outcome, alternativeRun, chosen, scheduleRun, showAllAlternatives,
    riskOn, busy, notice,
    selectGroup, reviewWeather, decideWeather, recommendAlternatives, chooseAlternative, decideScheduleChange,
    returnToAlternatives, toggleAlternatives, toggleRisk, reloadSchedule, answerAsMember,
  } = useAlerts({ festivals, onFail });

  useEffect(() => {
    if (alternativeRun || scheduleRun) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [alternativeRun, scheduleRun]);

  if (loading) return <div className="empty">알림 불러오는 중…</div>;

  const doneCount = scheduleRun?.status === "completed" ? 4 : scheduleRun ? 3 : alternativeRun ? 2 : outcome ? 4 : forecast ? 1 : 0;
  const curCount = outcome && !alternativeRun ? 2 : doneCount;
  const showRiskbar = !weatherPrompt && !scheduleRun && !alternativeRun && !outcome && Boolean(forecast?.risk);
  const header = (
    <AlertsHeader
      curCount={curCount}
      myGroups={myGroups}
      selectedGroupId={selectedGroupId}
      selectGroup={selectGroup}
      day={day}
      startTime={startTime}
      endTime={endTime}
      selectedFestival={selectedFestival}
      detail={detail}
    />
  );
  const memberSection = memberAlerts.length > 0 && (
    <MemberAlerts memberAlerts={memberAlerts} festivals={festivals} busy={busy} answerAsMember={answerAsMember} />
  );

  // 모임장인 모임이 없으면 참여자 화면만
  if (!myGroups.length)
    return (
      <div className="al-v3">
        {header}
        {memberSection || (
          <div className="sc-lock">
            <i className="ti ti-cloud-check" aria-hidden="true" />
            <b>받은 위험 알림이 없어요</b>
            <span>모임 날짜에 비가 예보되면 여기로 알려 드려요. 날씨 확인은 모임장이 할 수 있어요.</span>
          </div>
        )}
      </div>
    );

  return (
    <div className="al-v3">
      {header}

      {notice && (
        <div className="cm-notice al-notice" role="status">
          {notice}
        </div>
      )}

      {/* 결론 먼저: 비 예보면 두 칸 위에 상태 띠 + 이 화면의 유일한 주 버튼 */}
      {showRiskbar && (
        <button type="button" className="al-riskbar" disabled={!!busy} onClick={() => reviewWeather(false)}>
          <i className="ti ti-cloud-rain" aria-hidden="true" />
          <span className="al-rb-txt">
            <b>모임 시간에 비 예보가 있어요</b>
            <small>
              모임 시간 강수확률 최대 <em>{forecast?.weather?.data?.precipitationProbability ?? "–"}%</em> · 판단 기준 60% 이상
            </small>
          </span>
          <em>{busy === "check" ? "확인하는 중…" : "진행 여부 정하기"}</em>
        </button>
      )}

      <div className="sc-card al-card">
        <AlertForecast
          forecast={forecast}
          forecastStatus={forecastStatus}
          day={day}
          startTime={startTime}
          endTime={endTime}
          hasSchedule={items.length > 0}
          selectedFestival={selectedFestival}
          selectedGroupId={selectedGroupId}
          busy={busy}
          reviewWeather={reviewWeather}
        />
        <section className="sc-side al-panel" ref={panelRef}>
          <AlertWorkflowPanel
            weatherPrompt={weatherPrompt}
            forecast={forecast}
            scheduleRun={scheduleRun}
            chosen={chosen}
            alternativeRun={alternativeRun}
            outcome={outcome}
            day={day}
            busy={busy}
            showAllAlternatives={showAllAlternatives}
            decideWeather={decideWeather}
            decideScheduleChange={decideScheduleChange}
            returnToAlternatives={returnToAlternatives}
            chooseAlternative={chooseAlternative}
            toggleAlternatives={toggleAlternatives}
            recommendAlternatives={recommendAlternatives}
            detail={detail}
            schedule={schedule}
            items={items}
            riskOn={riskOn}
            toggleRisk={toggleRisk}
            reloadSchedule={reloadSchedule}
            onOpenSchedule={() => navigate(`/schedules?groupId=${encodeURIComponent(selectedGroupId)}`)}
          />
        </section>
      </div>

      {memberSection}
    </div>
  );
}

function AlertsHeader({ curCount, myGroups, selectedGroupId, selectGroup, day, startTime, endTime, selectedFestival, detail }) {
  return (
    <header className="al-head">
      <div className="al-head-row">
        <div>
          <h1>AI 알림·대체 축제</h1>
          <p>모임 날짜의 실제 예보를 확인하고, 비가 오면 진행할지 먼저 물어봐요</p>
        </div>
        <ol className="al-steps" aria-label="알림 진행 단계">
          {STEPS.map((x, i) => {
            const done = i < curCount;
            const cls = done ? "done" : i === curCount ? "cur" : "";
            return (
              <li key={x} className={cls}>
                {done ? <i className="ti ti-circle-check" aria-hidden="true" /> : <b>{String(i + 1).padStart(2, "0")}</b>}
                {x}
              </li>
            );
          })}
        </ol>
      </div>
      {myGroups.length > 0 && (
        <div className="al-ctx">
          <span className="al-ctx-label">모임</span>
          <label className="al-ctx-pick" title="모임 바꾸기">
            <select
              value={selectedGroupId}
              onChange={(e) => selectGroup(e.target.value)}
              aria-label="모임 바꾸기"
            >
              {myGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
            <i className="ti ti-chevron-down" aria-hidden="true" />
          </label>
          <span className="al-ctx-bar" aria-hidden="true" />
          <div className="al-ctx-meta">
            {day ? (
              <span>
                <i className="ti ti-calendar" aria-hidden="true" />
                {formatAlertDate(day)}{" "}
                <b>
                  {startTime}
                  {endTime && endTime !== startTime ? `–${endTime}` : ""}
                </b>
              </span>
            ) : null}
            {selectedFestival ? (
              <span>
                <i className="ti ti-map-pin" aria-hidden="true" />
                {[selectedFestival.region, selectedFestival.city].filter(Boolean).join(" ") || "지역 미정"}
              </span>
            ) : null}
            {detail ? (
              <span>
                <i className="ti ti-user-check" aria-hidden="true" />
                참여 {detail.memberCount}/{detail.capacity}명
              </span>
            ) : null}
          </div>
        </div>
      )}
    </header>
  );
}

function MemberAlerts({ memberAlerts, festivals, busy, answerAsMember }) {
  return (
    <section className="al-member">
      <h2 className="sc-h">받은 알림</h2>
      {memberAlerts.map((a) => (
        <div className="al-alert" key={a.id}>
          <span className="al-alert-ico">
            <i className="ti ti-cloud-rain" aria-hidden="true" />
          </span>
          <div className="al-alert-body">
            <b>{a.title}</b>
            <p>
              {festivals.find((festival) => festival.id === a.festivalId)?.name || "참여 예정 축제"} · {a.message}
            </p>
            {a.choice ? (
              <div className="cm-state ok">{a.choice === "continue" ? "참여 유지 의사를 전달했어요" : "모임장에게 대체 축제 요청을 전달했어요"}</div>
            ) : (
              <div className="al-alert-btns">
                <button type="button" className="btn" disabled={!!busy} onClick={() => answerAsMember(a, "continue")}>
                  네, 예정대로 참여할게요
                </button>
                <button type="button" className="btn primary" disabled={!!busy} onClick={() => answerAsMember(a, "find_alternative")}>
                  다른 축제를 원해요
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
