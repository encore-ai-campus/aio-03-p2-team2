import AlertGroupInfo from "./AlertGroupInfo.jsx";
import { alternativeDate, formatAlertDate } from "../lib/alertDates.js";

const md = (date) => (date ? date.slice(5).replace("-", ".") : "");

// 비교용 한 줄 목록
function MiniList({ items }) {
  if (!items?.length) return <p className="sc-empty-line">일정 없음</p>;
  return (
    <ul className="sc-mini">
      {items.map((x, i) => (
        <li key={i} title={`${x.time}${x.endTime ? `~${x.endTime}` : ""} ${x.label}`}>
          <b>{x.time}</b>
          <span>{x.label}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AlertWorkflowPanel({
  weatherPrompt, forecast, scheduleRun, chosen, alternativeRun, outcome, day, busy, showAllAlternatives,
  decideWeather, decideScheduleChange, returnToAlternatives, chooseAlternative, toggleAlternatives, recommendAlternatives,
  detail, schedule, items, riskOn, toggleRisk, reloadSchedule, onOpenSchedule,
}) {
  if (weatherPrompt) {
    const choices = weatherPrompt.interrupt.choices || [
      { value: "keep", label: "네, 기존 축제 유지" },
      { value: "alternatives", label: "아니요, 대체 축제 추천" },
    ];
    const sub = { keep: "일정은 그대로 두고, 참여자에게 우산 챙기기를 안내해요", alternatives: "같은 날 갈 수 있는 비슷한 축제를 AI가 찾아요" };
    return (
      <div className="al-q">
        <span className="wq-tag">
          <i className="ti ti-cloud-rain" aria-hidden="true" /> 비 예보{forecast?.isTest ? " · 시연용" : ""}
        </span>
        <h2>그래도 이 축제로 진행할까요?</h2>
        <p>{weatherPrompt.interrupt.message}</p>
        <div className="al-q-choices">
          {choices.map((c) => (
            <button key={c.value} type="button" className={`al-choice ${c.value === "alternatives" ? "pri" : ""}`} disabled={!!busy} onClick={() => decideWeather(c.value)}>
              <b>{busy === c.value ? (c.value === "alternatives" ? "AI가 대체 축제를 찾는 중…" : "처리 중…") : c.label}</b>
              <span>{sub[c.value] || ""}</span>
              <i className="ti ti-chevron-right" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (scheduleRun) {
    const ok = ["waiting_approval", "completed"].includes(scheduleRun.status);
    return (
      <div className="al-step">
        <button type="button" className="cm-back" onClick={returnToAlternatives} disabled={!!busy || scheduleRun.status === "completed"}>
          <i className="ti ti-arrow-left" aria-hidden="true" /> 다른 축제 고르기
        </button>
        <h2 className="sc-h">{chosen?.name || "대체 축제"}로 바꾸면</h2>
        <p className="sc-sub">
          {chosen ? `${chosen.region} · ${formatAlertDate(alternativeDate(chosen))} 기준으로 다시 만든 일정이에요.` : ""}
        </p>
        {ok ? (
          <div className="sc-compare-grid al-compare">
            <div>
              <span className="sc-compare-tag">기존</span>
              <MiniList items={scheduleRun.comparison?.before?.items} />
            </div>
            <i className="ti ti-arrow-right sc-compare-arrow" aria-hidden="true" />
            <div className="new">
              <span className="sc-compare-tag">새 일정</span>
              <MiniList items={scheduleRun.comparison?.after?.items || scheduleRun.candidate?.items} />
            </div>
          </div>
        ) : (
          <div className="sc-fail">
            <b>
              <i className="ti ti-alert-triangle" aria-hidden="true" /> 새 일정을 만들지 못했어요
            </b>
            <span>{scheduleRun.errors?.[0]?.message || scheduleRun.interrupt?.message || "다른 축제를 골라 주세요."}</span>
          </div>
        )}
        {(scheduleRun.candidateHistory?.length || 0) > 1 && (
          <p className="al-hint">AI가 검증에 실패한 초안을 {scheduleRun.candidateHistory.length - 1}번 스스로 고쳤어요.</p>
        )}
        {scheduleRun.status === "waiting_approval" && (
          <div className="sc-draft-btns">
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => decideScheduleChange("approve")}>
              {busy === "approve" ? "확정하는 중…" : "이 축제·일정으로 변경 확정"}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => decideScheduleChange("reject")}>
              기존 유지
            </button>
          </div>
        )}
        {scheduleRun.status === "completed" && (
          <div className="cm-state ok sc-gap">
            <i className="ti ti-circle-check" aria-hidden="true" /> 대체 축제와 새 일정으로 확정했어요! 참여자에게 공유돼요.
          </div>
        )}
      </div>
    );
  }

  if (alternativeRun) {
    const alternatives = alternativeRun.candidate?.items || [];
    return (
      <div className="al-step">
        <h2 className="sc-h">AI 대체 축제 {alternatives.length ? `${alternatives.length}곳` : ""}</h2>
        <p className="sc-sub">고르면 {formatAlertDate(day) || "모임 날짜"} 기준으로 일정을 다시 만들어요.</p>
        {alternativeRun.status !== "completed" ? (
          <div className="sc-fail">
            <b>
              <i className="ti ti-alert-triangle" aria-hidden="true" /> 대체 축제를 찾지 못했어요
            </b>
            <span>{alternativeRun.errors?.[0]?.message || alternativeRun.interrupt?.message || "잠시 후 다시 시도해 주세요."}</span>
          </div>
        ) : alternatives.length ? (
          <>
            <ul className="al-rows">
              {(showAllAlternatives ? alternatives : alternatives.slice(0, 3)).map((f) => (
                <li key={f.id}>
                  <button type="button" disabled={!!busy} onClick={() => chooseAlternative(f)}>
                    <span className="al-row-main">
                      <b>{f.name}</b>
                      <small>
                        <i className="ti ti-map-pin" aria-hidden="true" /> {f.region} · {md(f.startDate) === "01.01" && md(f.endDate) === "12.31" ? "상시 운영" : `${md(f.startDate)}–${md(f.endDate)}`}
                      </small>
                    </span>
                    <span className="al-row-go">{busy === `choose:${f.id}` ? "만드는 중…" : "일정 보기"}</span>
                    <i className="ti ti-chevron-right" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {alternatives.length > 3 && (
              <button type="button" className="al-more" onClick={toggleAlternatives}>
                {showAllAlternatives ? "접기" : `+${alternatives.length - 3}곳 더 보기`}
              </button>
            )}
          </>
        ) : (
          <p className="sc-empty-line">조건에 맞는 대체 축제가 없어요.</p>
        )}
        <p className="al-hint">변경은 모임장이 확정해야 반영돼요.</p>
      </div>
    );
  }

  if (outcome) {
    return (
      <div className="al-done">
        <span className="al-done-ico">
          <i className="ti ti-check" aria-hidden="true" />
        </span>
        <h2>기존 축제로 진행해요</h2>
        <p>{outcome === "keep" ? "비 예보가 있지만 유지하기로 했어요. 예보가 바뀌면 다시 알려 드릴게요." : "모임 시간에 진행을 막을 만한 예보가 없어요. 예보가 바뀌면 알려 드릴게요."}</p>
        <button type="button" className="btn" disabled={!!busy} onClick={recommendAlternatives}>
          {busy === "recommend" ? "AI가 대체 축제를 찾는 중…" : "그래도 대체 축제 보기"}
        </button>
      </div>
    );
  }

  return (
    <AlertGroupInfo
      detail={detail}
      schedule={schedule}
      items={items}
      riskOn={riskOn}
      busy={busy}
      toggleRisk={toggleRisk}
      reloadSchedule={reloadSchedule}
      onOpenSchedule={onOpenSchedule}
    />
  );
}
