// AI 알림·대체 축제 — 실제 API 버전
// 플로우: 악천후 감지(시험용 주입) → 참여자 알림 → 참여 의사 확인 → (모임장) 대체 축제 추천
//        → 대체 축제 선택 → 그 축제 기준 일정 재생성 → 기존·변경 일정 비교 → 모임장 확정
// 화면 구조·클래스는 기존 데모 알림 화면(AlertsPage)과 같게 유지한다.
import { useCallback, useEffect, useState } from "react";
import { useMe } from "../../auth/hooks/useMe.js";
import { listGroups } from "../../groups/api/groupsApi.js";
import { decideSchedule } from "../../schedules/api/scheduleApi.js";
import { answerAlert, enableRiskAlert, listAlerts, riskResponseForGroup, riskResponseFromAlert, selectAlternative, weatherCheck } from "../api/alertsApi.js";

const ERROR_TEXT = {
  LEADER_ONLY: "모임장만 할 수 있어요.",
  SCHEDULE_MISSING: "날씨를 확인할 일정이 없어요. 공동 일정을 먼저 확정해 주세요.",
  GROUP_NOT_AVAILABLE: "진행 중인 모임이 아니에요.",
  SIMULATION_DEVELOPMENT_ONLY: "시험용 악천후는 개발 환경에서만 만들 수 있어요.",
  ALERT_STALE: "모임 축제가 바뀌었어요. 최신 알림을 확인해 주세요.",
  ALTERNATIVE_NOT_OFFERED: "추천받은 축제 중에서 골라 주세요.",
  RISK_RESPONSE_REQUIRED: "대체 축제 추천을 먼저 받아 주세요.",
  RESOURCE_VERSION_CONFLICT: "모임 일정이 바뀌었어요. 다시 시도해 주세요.",
  CHECKPOINT_STALE: "상태가 바뀌었어요. 다시 시도해 주세요.",
};
const msg = (e) => ERROR_TEXT[e.code] || e.message || "요청에 실패했어요.";
const EMOJI = { 미식: "🍜", 음악: "🎵", 문화: "🎨", 전통: "🏮", 자연: "🌿" };
const STATUS_KO = { waiting_approval: "검증 통과 · 모임장 확정 대기", completed: "✅ 확정됨", waiting_input: "추가 확인 필요", failed: "실패", rejected: "기존 일정 유지", cancelled: "취소됨" };
const pad = (n) => String(n).padStart(2, "0");
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// 대체 축제 기간 안에서 오늘 이후 첫날 (지난 기간이면 시작일)
const dateIn = (f) => (f.startDate >= todayIso() ? f.startDate : todayIso() <= f.endDate ? todayIso() : f.startDate);

function Timeline({ items }) {
  if (!items?.length) return <div className="empty">일정이 없어요.</div>;
  return (
    <div className="timeline">
      {items.map((x, i) => (
        <div className="timeline-row" key={i}>
          <span className="time">
            {x.time}
            {x.endTime ? `~${x.endTime}` : ""}
          </span>
          <strong>{x.label}</strong>
          <p>
            {x.date ? `${x.date} · ` : ""}
            {x.description || ""}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function LiveAlerts({ festivals, pill, onFail }) {
  const me = useMe();
  const [groups, setGroups] = useState(null);
  const [groupId, setGroupId] = useState("");
  const [alerts, setAlerts] = useState([]);
  const [riskRun, setRiskRun] = useState(null); // 대체 축제 추천 실행
  const [scheduleRun, setScheduleRun] = useState(null); // 대체 축제 기준 일정 재생성 실행
  const [busy, setBusy] = useState(false);
  const [detectedNoAlert, setDetectedNoAlert] = useState(false); // 악천후는 감지됐지만 나에게 온 알림이 없음
  const [notice, setNotice] = useState("");
  const festival = (id) => festivals.find((f) => f.id === id);

  const loadAlerts = useCallback(() => listAlerts().then(setAlerts), []);
  useEffect(() => {
    Promise.all([listGroups(), listAlerts()])
      .then(([g, a]) => {
        setGroups(g);
        setAlerts(a);
      })
      .catch((e) => {
        console.warn("[alerts] API 실패 → 데모", e);
        onFail?.();
      });
  }, [onFail]);

  // 내가 모임장인 모임 (시험용 악천후는 모임장만 만들 수 있음)
  const myGroups = (groups || []).filter((g) => me && g.leaderId === me.id);
  const selectedGroupId = groupId || myGroups[0]?.id || "";
  const alert = alerts.find((a) => a.type === "rain" && a.status !== "dismissed") || alerts[0];
  const alertGroup = alert && (groups || []).find((g) => g.id === alert.groupId);
  const isLeaderOfAlert = alertGroup && me && alertGroup.leaderId === me.id;

  async function act(fn, done) {
    if (busy) return null;
    setBusy(true);
    setNotice("");
    try {
      const res = await fn();
      if (done) setNotice(done(res));
      return res;
    } catch (e) {
      console.warn("[alerts] 실패", e);
      setNotice(msg(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const simulate = () =>
    act(
      () => weatherCheck(selectedGroupId, true),
      (r) =>
        r.createdAlertCount
          ? `☔ 시험용 악천후를 감지했어요. 참여자 ${r.createdAlertCount}명에게 알림을 보냈어요.`
          : r.risk
            ? "☔ 악천후를 감지했어요. 다만 알림 수신에 동의한 참여자가 없어서 알림은 보내지 않았어요."
            : "악천후 예보가 없어요.",
    ).then(async (r) => {
      if (!r) return;
      const list = await listAlerts();
      setAlerts(list);
      setDetectedNoAlert(r.risk && !list.some((a) => a.groupId === selectedGroupId));
    });

  // 내 악천후 알림 수신을 켜고 다시 감지 (켜기 전에는 알림 행이 생성되지 않아 다시 시도해도 중복이 아님)
  const enableAndRetry = () => act(() => enableRiskAlert()).then((r) => r && simulate());

  const answer = (choice) =>
    act(() => answerAlert(alert.id, choice)).then(async (r) => {
      if (!r) return;
      await loadAlerts();
      // 대체 축제를 원하고 내가 모임장이면 바로 추천 실행
      if (choice === "find_alternative" && isLeaderOfAlert) recommend();
    });

  const recommend = () =>
    act(() => (alert?.groupId ? riskResponseFromAlert(alert.id) : riskResponseForGroup(selectedGroupId))).then((r) => {
      if (r) {
        setRiskRun(r);
        setScheduleRun(null);
      }
    });

  const choose = (f) => act(() => selectAlternative(riskRun.runId, f.id, dateIn(f))).then((r) => r && setScheduleRun(r));

  const decide = (decision) =>
    act(
      () => decideSchedule(scheduleRun, decision),
      () => (decision === "approve" ? "대체 축제와 새 일정으로 확정했어요! 참여자에게 공유돼요." : "변경을 거절했어요. 기존 축제와 일정은 그대로예요."),
    ).then((r) => r && setScheduleRun(r));

  if (!groups) return <div className="empty">알림 불러오는 중…</div>;
  const alternatives = riskRun?.candidate?.items || [];

  return (
    <>
      <div className="two" style={{ marginTop: "16px" }}>
        {/* 왼쪽: 시험용 악천후 주입 (발표 시연용) */}
        <div className="box pad demo-card">
          <span className="demo-tag">시연용 · 시험 데이터</span>
          <h2>악천후 상황 만들어 보기</h2>
          <p className="sm muted">실제 서비스에서는 날씨 예보로 자동 감지돼요. 시연을 위해 시험용 악천후를 만들 수 있어요. (알림 제목에 [테스트] 표시)</p>
          {myGroups.length ? (
            <>
              <div className="field">
                <label htmlFor="live-weather-group">영향을 받을 모임 (내가 모임장)</label>
                <select id="live-weather-group" value={selectedGroupId} onChange={(e) => setGroupId(e.target.value)}>
                  {myGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="btnrow">
                <button type="button" className="btn primary" disabled={busy || !selectedGroupId} onClick={simulate}>
                  ☔ 강수 예보 발생 (시험)
                </button>
              </div>
            </>
          ) : (
            <div className="note">내가 모임장인 모임이 없어요. AI 동행 매칭에서 모집글을 먼저 만들어 주세요.</div>
          )}
          <div className="divider" />
          <h3>AI 알림 처리 순서</h3>
          <div className="how" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <b>01 WATCH</b>
              <p>날씨 변화 감지</p>
            </div>
            <div>
              <b>02 ALERT</b>
              <p>참여자에게 알림</p>
            </div>
            <div>
              <b>03 ASK</b>
              <p>참여 의사 확인</p>
            </div>
            <div>
              <b>04 SUGGEST</b>
              <p>대체 축제·일정 제안</p>
            </div>
          </div>
        </div>

        {/* 오른쪽: 알림 센터 */}
        <div className="alert-panel">
          <span className="pill white" style={{ background: "#65708c" }}>
            AI 알림 센터
          </span>
          {notice && (
            <div className="note coral" role="status" style={{ marginTop: "12px" }}>
              {notice}
            </div>
          )}
          {!alert && detectedNoAlert ? (
            <>
              <h2 style={{ marginTop: "18px" }}>악천후가 감지됐어요</h2>
              <p className="sm">내 알림 수신이 꺼져 있어서 알림 센터에는 표시되지 않았어요.</p>
              <div className="btnrow">
                <button type="button" className="btn primary" disabled={busy} onClick={enableAndRetry}>
                  알림 받기 켜고 다시 감지
                </button>
                <button type="button" className="btn" disabled={busy} onClick={recommend}>
                  알림 없이 바로 대체 축제 추천
                </button>
              </div>
            </>
          ) : !alert ? (
            <div style={{ marginTop: "23px", textAlign: "center" }}>
              <div style={{ fontSize: "58px" }}>🌤️</div>
              <h2>받은 위험 알림이 없어요</h2>
              <p className="sm muted">모임 날짜에 악천후가 예보되면 여기로 알려 드려요.</p>
            </div>
          ) : (
            <>
              <h2 style={{ marginTop: "18px" }}>{alert.title}</h2>
              <p className="sm">
                {festival(alert.festivalId)?.name || "참여 예정 축제"} · {alert.message}
                <br />
                <b>“비 예보가 있어도 괜찮으세요?”</b> 계속 참여하시겠어요?
              </p>
              {alert.choice ? (
                <div className="note good" style={{ marginTop: "14px" }}>
                  {alert.choice === "continue"
                    ? "참여 유지 의사를 확인했어요. 예보가 바뀌면 다시 알려 드릴게요."
                    : isLeaderOfAlert
                      ? "대체 축제를 찾고 있어요. 아래에서 후보를 확인해 주세요."
                      : "모임장에게 대체 축제 요청이 전달됐어요. 변경되면 알려 드릴게요."}
                </div>
              ) : (
                <div className="btnrow">
                  <button type="button" className="btn green" disabled={busy} onClick={() => answer("continue")}>
                    네, 예정대로 참여할게요
                  </button>
                  <button type="button" className="btn primary" disabled={busy} onClick={() => answer("find_alternative")}>
                    아니요, 다른 축제 추천해 주세요
                  </button>
                </div>
              )}
              {isLeaderOfAlert && alert.choice && !riskRun && (
                <button type="button" className="btn" style={{ marginTop: "10px" }} disabled={busy} onClick={recommend}>
                  {busy ? "AI가 대체 축제를 찾는 중…" : "AI 대체 축제 추천 받기"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 대체 축제 후보 (모임장) */}
      {riskRun && (
        <>
          <div className="section-head">
            <div>
              <h2>AI 대체 축제 추천</h2>
              <p>{riskRun.candidate?.message || "같은 유형·지역을 우선 반영한 후보예요."}</p>
            </div>
            {pill("변경은 모임장 확정 후 반영", "purple")}
          </div>
          {riskRun.status !== "completed" ? (
            <div className="note warning">{riskRun.errors?.[0]?.message || riskRun.interrupt?.message || "대체 축제를 찾지 못했어요."}</div>
          ) : alternatives.length ? (
            <div className="alt-grid">
              {alternatives.map((f) => (
                <button key={f.id} type="button" className="alt-choice" disabled={busy} onClick={() => choose(f)}>
                  <span className="icon">{EMOJI[f.category] || "🎪"}</span>
                  <strong>{f.name}</strong>
                  <div className="metadata">
                    {f.region} · {f.startDate} ~ {f.endDate}
                  </div>
                  <p className="source-note" style={{ marginTop: "9px" }}>
                    선택하면 {dateIn(f)} 기준으로 일정을 다시 만들어요
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">조건에 맞는 대체 축제가 없어요.</div>
          )}
        </>
      )}

      {/* 기존 일정 ↔ 변경 일정 비교 → 모임장 확정 */}
      {scheduleRun && (
        <div className="box pad" style={{ marginTop: "16px" }}>
          <div className="section-head" style={{ marginTop: 0 }}>
            <h2>🔁 기존 일정 ↔ 변경 일정 비교</h2>
            {pill(STATUS_KO[scheduleRun.status] || scheduleRun.status, scheduleRun.status === "completed" ? "green" : scheduleRun.status === "waiting_approval" ? "purple" : "dark")}
          </div>
          {["waiting_approval", "completed"].includes(scheduleRun.status) ? (
            <div className="two">
              <div>
                <div className="tiny muted">기존 일정</div>
                <Timeline items={scheduleRun.comparison?.before?.items} />
              </div>
              <div>
                <div className="tiny muted">변경 일정 (대체 축제)</div>
                <Timeline items={scheduleRun.comparison?.after?.items || scheduleRun.candidate?.items} />
              </div>
            </div>
          ) : (
            <div className="note warning">{scheduleRun.errors?.[0]?.message || scheduleRun.interrupt?.message || "새 일정을 만들지 못했어요. 다른 축제를 골라 주세요."}</div>
          )}
          {(scheduleRun.candidateHistory?.length || 0) > 1 && (
            <p className="sm muted" style={{ marginTop: "8px" }}>
              AI가 검증에 실패한 초안을 {scheduleRun.candidateHistory.length - 1}번 스스로 고쳤어요.
            </p>
          )}
          {scheduleRun.status === "waiting_approval" && (
            <div className="btnrow" style={{ marginTop: "12px" }}>
              <button type="button" className="btn primary" disabled={busy} onClick={() => decide("approve")}>
                이 축제·일정으로 변경 확정
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => decide("reject")}>
                기존 일정 유지
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
