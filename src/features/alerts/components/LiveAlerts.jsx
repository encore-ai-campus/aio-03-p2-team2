// AI 알림·대체 축제 — 실제 API 버전 (v3 화면)
// 모임장: 모임 카드 → 한 장 카드(왼쪽 실제 날씨 | 오른쪽: 처음엔 확정된 모임 일정, 이후 단계별 결과)
//   날씨 확인 weather-review → 비 예보면 「그래도 진행할까요?」 → 네: 유지 / 아니요: 대체 축제 목록(같은 자리)
//   → 축제 선택 → 그 축제 기준 일정 재생성 → 기존·새 일정 비교 → 모임장 확정
// 참여자: 받은 악천후 알림 → 계속 참여 / 다른 축제 요청
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { getGroup, listGroups } from "../../groups/api/groupsApi.js";
import { decideSchedule, getSchedule } from "../../schedules/api/scheduleApi.js";
import { fetchFestival } from "../../festivals/api/festivalsApi.js";
import { resumeAgentRun } from "../../matching/api/agentsApi.js";
import { answerAlert, listAlerts, riskResponseForGroup, selectAlternative, setRiskAlert, weatherCheck, weatherReview } from "../api/alertsApi.js";

const ERROR_TEXT = {
  LEADER_ONLY: "모임장만 할 수 있어요.",
  SCHEDULE_MISSING: "날씨를 확인할 일정이 없어요. 공동 일정을 먼저 확정해 주세요.",
  GROUP_NOT_AVAILABLE: "진행 중인 모임이 아니에요.",
  SIMULATION_DEVELOPMENT_ONLY: "악천후 시뮬레이션은 개발 환경에서만 할 수 있어요.",
  ALERT_STALE: "모임 축제가 바뀌었어요. 최신 알림을 확인해 주세요.",
  ALTERNATIVE_NOT_OFFERED: "추천받은 축제 중에서 골라 주세요.",
  RISK_RESPONSE_REQUIRED: "대체 축제 추천을 먼저 받아 주세요.",
  RESOURCE_VERSION_CONFLICT: "모임 일정이 바뀌었어요. 다시 시도해 주세요.",
  CHECKPOINT_STALE: "상태가 바뀌었어요. 다시 시도해 주세요.",
  WEATHER_DECISION_REQUIRED: "유지할지, 대체 축제를 추천받을지 골라 주세요.",
};
const msg = (e) => ERROR_TEXT[e.code] || e.message || "요청에 실패했어요.";
const STEPS = ["날씨 확인", "진행 여부", "대체 축제", "일정 확정"];
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n) => String(n).padStart(2, "0");
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const dayLabel = (d) => {
  if (!d) return "";
  const t = new Date(`${d}T00:00:00`);
  return `${t.getMonth() + 1}/${t.getDate()}(${WD[t.getDay()]})`;
};
const md = (d) => (d ? d.slice(5).replace("-", ".") : "");
// 대체 축제 기간 안에서 오늘 이후 첫날 (지난 기간이면 시작일)
const dateIn = (f) => (f.startDate >= todayIso() ? f.startDate : todayIso() <= f.endDate ? todayIso() : f.startDate);
const fetchedTime = (iso) => (iso ? new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "");

// WMO 날씨 코드 → 아이콘·이름·색
function weatherLook(code) {
  if (code == null) return { icon: "ti-cloud", label: "알 수 없음", tone: "gray" };
  if (code === 0) return { icon: "ti-sun", label: "맑음", tone: "sun" };
  if (code <= 2) return { icon: "ti-sun", label: "구름 조금", tone: "sun" };
  if (code === 3) return { icon: "ti-cloud", label: "흐림", tone: "gray" };
  if (code === 45 || code === 48) return { icon: "ti-mist", label: "안개", tone: "gray" };
  if (code >= 51 && code <= 57) return { icon: "ti-cloud-rain", label: "이슬비", tone: "rain" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: "ti-cloud-rain", label: "비", tone: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: "ti-snowflake", label: "눈", tone: "rain" };
  if (code >= 95) return { icon: "ti-cloud-storm", label: "뇌우", tone: "storm" };
  return { icon: "ti-cloud", label: "흐림", tone: "gray" };
}

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

export default function LiveAlerts({ festivals, onFail }) {
  const me = useMe();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null); // 선택한 모임 상세 (축제·참여자)
  const [sched, setSched] = useState(null); // 선택한 모임의 확정 일정
  const [reloadKey, setReloadKey] = useState(0);
  const [riskOn, setRiskOn] = useState(null); // 내 악천후 알림 수신 (null = 아직 모름)
  const [autoWx, setAutoWx] = useState("");
  const [festInfo, setFestInfo] = useState(null); // 축제 목록에 없을 때 상세로 불러온 축제
  const [showAllAlts, setShowAllAlts] = useState(false); // 자동 날씨 조회 상태: "" | "loading" | 오류 문구
  const [groups, setGroups] = useState(null);
  const [groupId, setGroupId] = useState("");
  const [alerts, setAlerts] = useState([]);
  const [wx, setWx] = useState(null); // 마지막 날씨 확인 결과 (weatherCheck)
  const [weatherQ, setWeatherQ] = useState(null); // 「그래도 진행할까요?」 대기 중인 실행
  const [outcome, setOutcome] = useState(null); // "keep" | "clear" (예보 문제 없음)
  const [riskRun, setRiskRun] = useState(null); // 대체 축제 추천 실행
  const [chosen, setChosen] = useState(null); // 고른 대체 축제
  const [scheduleRun, setScheduleRun] = useState(null); // 대체 축제 기준 일정 재생성 실행
  const [busy, setBusy] = useState(""); // 진행 중인 작업 이름
  const [notice, setNotice] = useState("");
  const panelRef = useRef(null);
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

  // 대체 축제·비교가 나오면 오른쪽 칸이 보이게
  useEffect(() => {
    if (riskRun || scheduleRun) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [riskRun, scheduleRun]);

  const myGroups = (groups || []).filter((g) => me && g.leaderId === me.id);
  const selectedGroupId = groupId || myGroups[0]?.id || "";
  const group = myGroups.find((g) => g.id === selectedGroupId);

  // 내 악천후 알림 수신 상태
  useEffect(() => {
    if (me) setRiskOn(!!me.notificationConsent?.riskAlert);
  }, [me]);

  // 선택한 모임의 상세·확정 일정 (목록 응답엔 일정·참여자가 없음)
  useEffect(() => {
    if (!selectedGroupId) return;
    let alive = true;
    setDetail(null);
    setSched(null);
    Promise.all([getGroup(selectedGroupId).catch(() => null), getSchedule(selectedGroupId).catch((e) => ({ loadError: msg(e) }))]).then(([d, sc]) => {
      if (!alive) return;
      setDetail(d);
      setSched(sc);
    });
    return () => {
      alive = false;
    };
  }, [selectedGroupId, reloadKey]);

  // 화면을 열면(또는 모임을 바꾸면) 실제 예보를 바로 불러온다 — 에이전트 실행 없이 날씨만 (weather-check)
  // 확정 일정이 없으면 서버가 SCHEDULE_MISSING을 돌려주므로 일정이 있을 때만 부른다
  useEffect(() => {
    if (!selectedGroupId || !sched?.items?.length) return;
    let alive = true;
    setAutoWx("loading");
    weatherCheck(selectedGroupId, false)
      .then((r) => {
        if (!alive) return;
        setWx((cur) => cur || r);
        setAutoWx("");
      })
      .catch((e) => alive && setAutoWx(msg(e)));
    return () => {
      alive = false;
    };
  }, [selectedGroupId, sched]);

  const fid = detail?.festivalId || group?.festivalId;
  useEffect(() => {
    setFestInfo(null);
    if (!fid || festivals.some((f) => f.id === fid)) return;
    let alive = true;
    fetchFestival(fid)
      .then((f) => alive && setFestInfo(f))
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [fid, festivals]);
  const gf = festival(fid) || festInfo;
  const items = sched?.items || [];
  const day = items[0]?.date;
  const sameDay = items.filter((x) => x.date === day);
  const startT = sameDay.length ? sameDay.map((x) => x.time).sort()[0] : "";
  const endT = sameDay.length ? sameDay.map((x) => x.endTime || x.time).sort().slice(-1)[0] : "";

  function resetFlow() {
    setWx(null);
    setWeatherQ(null);
    setOutcome(null);
    setRiskRun(null);
    setChosen(null);
    setScheduleRun(null);
    setNotice("");
  }

  async function act(name, fn) {
    if (busy) return null;
    setBusy(name);
    setNotice("");
    try {
      return await fn();
    } catch (e) {
      console.warn("[alerts] 실패", e);
      setNotice(msg(e));
      return null;
    } finally {
      setBusy("");
    }
  }

  // 날씨 확인 (simulateRisk: 시연용 악천후) → 비 예보면 질문, 아니면 「기존대로 진행」
  const review = (simulateRisk) =>
    act(simulateRisk ? "sim" : "check", async () => {
      resetFlow();
      const r = await weatherReview(selectedGroupId, simulateRisk);
      setWx(r.weatherCheck);
      loadAlerts();
      if (r.run?.status === "waiting_input" && r.run.interrupt?.type === "weather_confirmation") setWeatherQ(r.run);
      else setOutcome("clear");
      return r;
    });

  // 「그래도 진행할까요?」 — keep: 유지 / alternatives: 대체 축제 목록(같은 자리)
  const decideWeather = (weatherDecision) =>
    act(weatherDecision, async () => {
      const res = await resumeAgentRun(weatherQ.runId, { checkpointId: weatherQ.checkpointId, weatherDecision });
      setWeatherQ(null);
      // 모임장 본인 알림이 있으면 같은 답으로 맞춰 둔다 (실패해도 흐름에는 영향 없음)
      const mine = alerts.find((a) => a.groupId === selectedGroupId && !a.choice);
      if (mine) await answerAlert(mine.id, weatherDecision === "keep" ? "continue" : "find_alternative").catch(() => null);
      loadAlerts();
      if (weatherDecision === "keep") setOutcome("keep");
      else {
        setShowAllAlts(false);
        setRiskRun(res);
      }
      return res;
    });

  // 내 악천후 알림 켜기/끄기 (바로 저장)
  const toggleRisk = () =>
    act("risk", async () => {
      const next = !riskOn;
      await setRiskAlert(next);
      setRiskOn(next);
      return next;
    });

  // 비 예보일 때 「진행 여부 정하기」 → 에이전트 질문 시작 (실제 예보 기준)
  const askDecision = () => review(false);

  // 유지 후에도 대체 축제를 보고 싶을 때
  const recommend = () =>
    act("recommend", async () => {
      const r = await riskResponseForGroup(selectedGroupId);
      setOutcome(null);
      setRiskRun(r);
      return r;
    });

  const choose = (f) =>
    act(`choose:${f.id}`, async () => {
      const r = await selectAlternative(riskRun.runId, f.id, dateIn(f));
      setChosen(f);
      setScheduleRun(r);
      return r;
    });

  const decide = (decision) =>
    act(decision, async () => {
      const r = await decideSchedule(scheduleRun, decision);
      setScheduleRun(r);
      if (decision === "approve") setReloadKey((k) => k + 1);
      if (decision === "reject") setNotice("변경하지 않았어요. 기존 축제와 일정은 그대로예요.");
      return r;
    });

  if (!groups) return <div className="empty">알림 불러오는 중…</div>;

  // 진행 단계
  const doneCount = scheduleRun?.status === "completed" ? 4 : scheduleRun ? 3 : riskRun ? 2 : outcome ? 4 : wx ? 1 : 0;
  const curCount = outcome && !riskRun ? 2 : doneCount; // 유지·문제 없음이면 「진행 여부」까지만 완료로 보이게
  const head = (
    <div className="mp-head">
      <div>
        <h1>AI 알림·대체 축제</h1>
        <p>모임 날짜의 실제 예보를 확인하고, 비가 오면 진행할지 먼저 물어봐요</p>
      </div>
      <ol className="mp-steps" aria-label="알림 진행 단계">
        {STEPS.map((x, i) => {
          const done = i < curCount;
          const cls = done ? "done" : i === curCount ? "cur" : "";
          return (
            <li key={x} className={cls}>
              {done ? <i className="ti ti-circle-check" aria-hidden="true" /> : <span>{pad(i + 1)}</span>}
              {x}
            </li>
          );
        })}
      </ol>
    </div>
  );

  // 참여자 알림 (내가 모임장이 아닌 모임의 알림)
  const memberAlerts = alerts.filter((a) => a.type === "rain" && a.status !== "dismissed" && !myGroups.some((g) => g.id === a.groupId));
  const answerAsMember = (a, choice) => act(`ans:${a.id}`, () => answerAlert(a.id, choice).then(loadAlerts));
  const memberSection = memberAlerts.length ? (
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
              {festival(a.festivalId)?.name || "참여 예정 축제"} · {a.message}
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
  ) : null;

  // 모임장인 모임이 없으면 참여자 화면만
  if (!myGroups.length)
    return (
      <>
        {head}
        {memberSection || (
          <div className="sc-lock">
            <i className="ti ti-cloud-check" aria-hidden="true" />
            <b>받은 위험 알림이 없어요</b>
            <span>모임 날짜에 비가 예보되면 여기로 알려 드려요. 날씨 확인은 모임장이 할 수 있어요.</span>
          </div>
        )}
      </>
    );

  // 왼쪽: 날씨 카드
  const data = wx?.weather?.data;
  const look = weatherLook(data?.weatherCode);
  const hourly = (data?.hourly || []).slice(0, 8);
  // 시뮬레이션·데모는 시간별 값이 없어서 모임 시간대를 같은 값으로 채운다 (출처 줄에 「시연용」 표시)
  const hours = hourly.length
    ? hourly
    : data && startT
      ? Array.from({ length: Math.max(1, Number((endT || startT).slice(0, 2)) - Number(startT.slice(0, 2)) + 1) }, (_, i) => {
          const hh = String(Number(startT.slice(0, 2)) + i).padStart(2, "0");
          return { time: `${data.date || day}T${hh}:00`, precipitationProbability: data.precipitationProbability, weatherCode: data.weatherCode };
        })
      : [];
  const weatherCard = (
    <section className="al-weather">
      <h2 className="sc-h">모임 시간 날씨</h2>
      {!wx ? (
        <div className="al-wx-empty">
          <i className={`ti ${autoWx === "loading" ? "ti-loader-2 al-spin" : "ti-cloud"}`} aria-hidden="true" />
          <b>{autoWx === "loading" ? "실제 예보를 불러오는 중…" : autoWx ? "예보를 불러오지 못했어요" : items.length ? "날씨를 불러올 준비 중이에요" : "확정된 일정이 없어요"}</b>
          <span>{autoWx && autoWx !== "loading" ? autoWx : items.length ? "모임 날짜·시간·장소 기준으로 실제 예보를 보여 드려요." : "공동 일정을 확정하면 그 날짜의 예보를 보여 드려요."}</span>
        </div>
      ) : (
        <>
          <div className={`al-wx-now ${look.tone}`}>
            <span className="al-wx-ico">
              <i className={`ti ${look.icon}`} aria-hidden="true" />
            </span>
            <div>
              <b>
                {look.label}
                {data?.precipitationProbability != null ? ` · 강수 ${data.precipitationProbability}%` : ""}
              </b>
              <span>
                {dayLabel(data?.date || wx.date)}
                {data?.startTime ? ` ${data.startTime}–${data.endTime}` : startT ? ` ${startT}–${endT}` : ""}
                {data?.windSpeed != null ? ` · 바람 ${data.windSpeed}${data.windSpeedUnit || "m/s"}` : ""}
              </span>
            </div>
            <span className={`cm-badge ${wx.risk ? "approval" : "open"} al-wx-risk`}>{wx.risk ? "악천후 주의" : "진행 문제 없음"}</span>
          </div>
          {hours.length > 0 && (
            <div className="al-hours" aria-label="시간별 예보">
              {hours.map((h) => {
                const hl = weatherLook(h.weatherCode);
                const p = h.precipitationProbability ?? 0;
                return (
                  <div key={h.time} className={`al-hour ${p >= 60 ? "hi" : ""}`}>
                    <small>{String(h.time).slice(11, 13)}시</small>
                    <i className={`ti ${hl.icon}`} aria-hidden="true" />
                    <div className="al-hour-bar">
                      <span style={{ height: `${Math.max(4, p)}%` }} />
                    </div>
                    <b>{p}%</b>
                  </div>
                );
              })}
            </div>
          )}
          <p className="al-source">
            <i className="ti ti-database" aria-hidden="true" />
            {wx.isTest || wx.weather?.mode === "simulation"
              ? "시연용 악천후 시뮬레이션 데이터"
              : wx.weather?.mode === "demo"
                ? "데모 날씨 데이터 (실시간 예보 꺼짐)"
                : `${wx.weather?.source || "날씨 예보"} 실시간 예보`}
            {wx.weather?.fetchedAt ? ` · ${fetchedTime(wx.weather.fetchedAt)} 조회` : ""}
          </p>
        </>
      )}
      <div className="al-wx-btns">
        <button type="button" className="btn primary" disabled={!!busy || !selectedGroupId} onClick={() => review(false)}>
          <i className="ti ti-refresh" aria-hidden="true" /> {busy === "check" ? "확인하는 중…" : wx?.risk ? "진행 여부 정하기" : "날씨 다시 확인"}
        </button>
        <button type="button" className="btn" disabled={!!busy || !selectedGroupId} onClick={() => review(true)}>
          ☔ {busy === "sim" ? "시뮬레이션 중…" : "악천후 시뮬레이션"}
        </button>
      </div>
      <p className="al-hint">「악천후 시뮬레이션」은 시연용으로 비 예보를 만들어 확인해요. 참여자에게 [테스트] 알림이 함께 가요.</p>
    </section>
  );

  // 오른쪽: 단계별 결과
  const alternatives = riskRun?.candidate?.items || [];
  let panel;
  if (weatherQ) {
    const choices = weatherQ.interrupt.choices || [
      { value: "keep", label: "네, 기존 축제 유지" },
      { value: "alternatives", label: "아니요, 대체 축제 추천" },
    ];
    const sub = { keep: "일정은 그대로 두고, 참여자에게 우산 챙기기를 안내해요", alternatives: "같은 날 갈 수 있는 비슷한 축제를 AI가 찾아요" };
    panel = (
      <div className="al-q">
        <span className="wq-tag">
          <i className="ti ti-cloud-rain" aria-hidden="true" /> 비 예보{wx?.isTest ? " · 시연용" : ""}
        </span>
        <h2>그래도 이 축제로 진행할까요?</h2>
        <p>{weatherQ.interrupt.message}</p>
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
  } else if (scheduleRun) {
    const ok = ["waiting_approval", "completed"].includes(scheduleRun.status);
    panel = (
      <div className="al-step">
        <button type="button" className="cm-back" onClick={() => setScheduleRun(null)} disabled={!!busy || scheduleRun.status === "completed"}>
          <i className="ti ti-arrow-left" aria-hidden="true" /> 다른 축제 고르기
        </button>
        <h2 className="sc-h">{chosen?.name || "대체 축제"}로 바꾸면</h2>
        <p className="sc-sub">
          {chosen ? `${chosen.region} · ${dayLabel(dateIn(chosen))} 기준으로 다시 만든 일정이에요.` : ""}
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
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => decide("approve")}>
              {busy === "approve" ? "확정하는 중…" : "이 축제·일정으로 변경 확정"}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => decide("reject")}>
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
  } else if (riskRun) {
    panel = (
      <div className="al-step">
        <h2 className="sc-h">AI 대체 축제 {alternatives.length ? `${alternatives.length}곳` : ""}</h2>
        <p className="sc-sub">고르면 {dayLabel(day) || "모임 날짜"} 기준으로 일정을 다시 만들어요.</p>
        {riskRun.status !== "completed" ? (
          <div className="sc-fail">
            <b>
              <i className="ti ti-alert-triangle" aria-hidden="true" /> 대체 축제를 찾지 못했어요
            </b>
            <span>{riskRun.errors?.[0]?.message || riskRun.interrupt?.message || "잠시 후 다시 시도해 주세요."}</span>
          </div>
        ) : alternatives.length ? (
          <>
            <ul className="al-rows">
              {(showAllAlts ? alternatives : alternatives.slice(0, 3)).map((f) => (
                <li key={f.id}>
                  <button type="button" disabled={!!busy} onClick={() => choose(f)}>
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
              <button type="button" className="al-more" onClick={() => setShowAllAlts((v) => !v)}>
                {showAllAlts ? "접기" : `+${alternatives.length - 3}곳 더 보기`}
              </button>
            )}
          </>
        ) : (
          <p className="sc-empty-line">조건에 맞는 대체 축제가 없어요.</p>
        )}
        <p className="al-hint">변경은 모임장이 확정해야 반영돼요.</p>
      </div>
    );
  } else if (outcome) {
    panel = (
      <div className="al-done">
        <span className="al-done-ico">
          <i className="ti ti-check" aria-hidden="true" />
        </span>
        <h2>기존 축제로 진행해요</h2>
        <p>{outcome === "keep" ? "비 예보가 있지만 유지하기로 했어요. 예보가 바뀌면 다시 알려 드릴게요." : "모임 시간에 진행을 막을 만한 예보가 없어요. 예보가 바뀌면 알려 드릴게요."}</p>
        <button type="button" className="btn" disabled={!!busy} onClick={recommend}>
          {busy === "recommend" ? "AI가 대체 축제를 찾는 중…" : "그래도 대체 축제 보기"}
        </button>
      </div>
    );
  } else {
    // 처음: 날씨의 영향을 받는 확정 일정
    panel = (
      <>
        {wx?.risk && (
          <button type="button" className="al-riskbar" disabled={!!busy} onClick={askDecision}>
            <i className="ti ti-cloud-rain" aria-hidden="true" />
            <span>
              <b>모임 시간에 비 예보가 있어요</b>
              <small>그대로 진행할지, 대체 축제를 찾을지 정해 주세요</small>
            </span>
            <em>{busy === "check" ? "확인하는 중…" : "진행 여부 정하기"}</em>
          </button>
        )}
        <h2 className="sc-h">확정된 모임 일정</h2>
        <p className="sc-sub">이 일정의 날짜·시간·장소 기준으로 날씨를 확인해요.</p>
        {items.length ? (
          <ol className="sc-tl">
            {items.map((x, i) => (
              <li key={i}>
                <span className="sc-tl-time">
                  <b>{x.time}</b>
                  {x.endTime ? <small>~{x.endTime}</small> : null}
                </span>
                <span className="sc-tl-body">
                  <b>{x.label}</b>
                  {x.date || x.description ? (
                    <small>
                      {x.date ? `${dayLabel(x.date)}${x.description ? " · " : ""}` : ""}
                      {x.description || ""}
                    </small>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : sched === null && !detail ? (
          <p className="sc-empty-line">일정 불러오는 중…</p>
        ) : sched?.loadError ? (
          <div className="sc-fail">
            <b>
              <i className="ti ti-plug-connected-x" aria-hidden="true" /> 일정을 불러오지 못했어요
            </b>
            <span>{sched.loadError} 서버 연결을 확인한 뒤 다시 시도해 주세요.</span>
            <button type="button" className="btn small al-go" onClick={() => setReloadKey((k) => k + 1)}>
              다시 불러오기
            </button>
          </div>
        ) : (
          <div className="sc-fail">
            <b>
              <i className="ti ti-calendar-off" aria-hidden="true" /> 아직 확정된 일정이 없어요
            </b>
            <span>날씨는 확정된 일정 기준으로 확인해요. 공동 일정을 먼저 확정해 주세요.</span>
            <button type="button" className="btn small al-go" onClick={() => navigate(`/schedules?groupId=${encodeURIComponent(selectedGroupId)}`)}>
              공동 일정으로 가기 →
            </button>
          </div>
        )}
        {detail?.members?.length ? (
          <div className="al-who">
            <div className="al-who-head">
              <span className="al-who-title">
                <i className="ti ti-bell" aria-hidden="true" /> 비가 예보되면 알림을 받는 참여자
              </span>
              <a className="al-who-link" href="/profile" onClick={(e) => (e.preventDefault(), navigate("/profile"))}>
                알림 설정 →
              </a>
            </div>
            <div className="al-toggle-row">
              <span>
                <b>내 악천후 알림 받기</b>
                <small>{riskOn ? "비가 예보되면 알림 센터로 알려 드려요" : "꺼져 있으면 비 예보 알림이 오지 않아요"}</small>
              </span>
              <button type="button" role="switch" aria-checked={!!riskOn} aria-label="내 악천후 알림 받기" className={`al-switch ${riskOn ? "on" : ""}`} disabled={riskOn === null || busy === "risk"} onClick={toggleRisk}>
                <span />
              </button>
            </div>
            <div className="cm-members">
              {detail.members.map((m) => (
                <span key={m.userId} className={m.role === "leader" ? "leader" : ""}>
                  {m.role === "leader" ? <i className="ti ti-crown" aria-hidden="true" /> : null}
                  {m.user.displayName}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      {head}

      {/* 모임 카드 */}
      <div className="sc-group">
        <div className="sc-group-ico">
          <i className="ti ti-users" aria-hidden="true" />
        </div>
        <div className="sc-group-info">
          <h3>{group?.title}</h3>
          <div className="sc-group-meta">
            <span>
              <i className="ti ti-confetti" aria-hidden="true" /> {gf?.name || (detail ? "축제 정보 없음" : "불러오는 중…")}
            </span>
            <span>
              <i className="ti ti-map-pin" aria-hidden="true" /> {gf ? [gf.region, gf.city].filter(Boolean).join(" ") : "지역 미정"}
            </span>
            {day ? (
              <span>
                <i className="ti ti-calendar" aria-hidden="true" /> {dayLabel(day)} {startT}
                {endT && endT !== startT ? `–${endT}` : ""}
              </span>
            ) : null}
            {detail ? (
              <span>
                <i className="ti ti-user-check" aria-hidden="true" /> 참여 확정 {detail.memberCount}/{detail.capacity}명
              </span>
            ) : null}
          </div>
        </div>
        <label className="sc-group-change">
          <span>모임 변경</span>
          <select
            value={selectedGroupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              resetFlow();
            }}
            aria-label="모임 변경"
          >
            {myGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {notice && (
        <div className="cm-notice al-notice" role="status">
          {notice}
        </div>
      )}

      <div className="sc-card al-card">
        {weatherCard}
        <section className="sc-side al-panel" ref={panelRef}>
          {panel}
        </section>
      </div>

      {memberSection}
    </>
  );
}
