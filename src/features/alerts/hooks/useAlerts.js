import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { getGroup, listGroups } from "../../groups/api/groupsApi.js";
import { decideSchedule, getSchedule } from "../../schedules/api/scheduleApi.js";
import { fetchFestival } from "../../festivals/api/festivalsApi.js";
import { resumeAgentRun } from "../../matching/api/agentsApi.js";
import { answerAlert, listAlerts, riskResponseForGroup, selectAlternative, setRiskAlert, weatherCheck, weatherReview } from "../api/alertsApi.js";
import { alternativeDate } from "../lib/alertDates.js";

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
const alertError = (e) => ERROR_TEXT[e.code] || e.message || "요청에 실패했어요.";

export function useAlerts({ festivals, onFail }) {
  const me = useMe();
  const [detail, setDetail] = useState(null); // 선택한 모임 상세 (축제·참여자)
  const [schedule, setSchedule] = useState(null); // 선택한 모임의 확정 일정
  const [reloadKey, setReloadKey] = useState(0);
  const [riskOn, setRiskOn] = useState(null); // 내 악천후 알림 수신 (null = 아직 모름)
  const [forecastStatus, setForecastStatus] = useState("");
  const [festInfo, setFestInfo] = useState(null); // 축제 목록에 없을 때 상세로 불러온 축제
  const [showAllAlternatives, setShowAllAlternatives] = useState(false);
  const [groups, setGroups] = useState(null);
  // 알림에서 들어오면 주소의 groupId(/alerts?groupId=…)로 그 모임을 먼저 선택
  const [params] = useSearchParams();
  const urlGroupId = params.get("groupId") || "";
  const [groupId, setGroupId] = useState(urlGroupId);
  useEffect(() => {
    if (urlGroupId) setGroupId(urlGroupId);
  }, [urlGroupId]);
  const [alerts, setAlerts] = useState([]);
  const [forecast, setForecast] = useState(null); // 마지막 날씨 확인 결과 (weatherCheck)
  const [weatherPrompt, setWeatherPrompt] = useState(null); // 「그래도 진행할까요?」 대기 중인 실행
  const [outcome, setOutcome] = useState(null); // "keep" | "clear" (예보 문제 없음)
  const [alternativeRun, setAlternativeRun] = useState(null); // 대체 축제 추천 실행
  const [chosen, setChosen] = useState(null); // 고른 대체 축제
  const [scheduleRun, setScheduleRun] = useState(null); // 대체 축제 기준 일정 재생성 실행
  const [busy, setBusy] = useState(""); // 진행 중인 작업 이름
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
        console.warn("[alerts] API 조회 실패", e);
        onFail?.();
      });
  }, [onFail]);

  const myGroups = (groups || []).filter((g) => me && g.leaderId === me.id);
  const selectedGroupId = (myGroups.some((g) => g.id === groupId) ? groupId : "") || myGroups[0]?.id || "";
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
    setSchedule(null);
    Promise.all([getGroup(selectedGroupId).catch(() => null), getSchedule(selectedGroupId).catch((e) => ({ loadError: alertError(e) }))]).then(([d, sc]) => {
      if (!alive) return;
      setDetail(d);
      setSchedule(sc);
    });
    return () => {
      alive = false;
    };
  }, [selectedGroupId, reloadKey]);

  // 화면을 열면(또는 모임을 바꾸면) 실제 예보를 바로 불러온다 — 에이전트 실행 없이 날씨만 (weather-check)
  // 확정 일정이 없으면 서버가 SCHEDULE_MISSING을 돌려주므로 일정이 있을 때만 부른다
  useEffect(() => {
    if (!selectedGroupId || !schedule?.items?.length) return;
    let alive = true;
    setForecastStatus("loading");
    weatherCheck(selectedGroupId, false)
      .then((r) => {
        if (!alive) return;
        setForecast((cur) => cur || r);
        setForecastStatus("");
      })
      .catch((e) => alive && setForecastStatus(alertError(e)));
    return () => {
      alive = false;
    };
  }, [selectedGroupId, schedule]);

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
  const selectedFestival = festival(fid) || festInfo;
  const items = schedule?.items || [];
  const day = items[0]?.date;
  const sameDay = items.filter((x) => x.date === day);
  const startTime = sameDay.length ? sameDay.map((x) => x.time).sort()[0] : "";
  const endTime = sameDay.length ? sameDay.map((x) => x.endTime || x.time).sort().slice(-1)[0] : "";

  function resetFlow() {
    setForecast(null);
    setWeatherPrompt(null);
    setOutcome(null);
    setAlternativeRun(null);
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
      setNotice(alertError(e));
      return null;
    } finally {
      setBusy("");
    }
  }

  // 날씨 확인 (simulateRisk: 시연용 악천후) → 비 예보면 질문, 아니면 「기존대로 진행」
  const reviewWeather = (simulateRisk) =>
    act(simulateRisk ? "sim" : "check", async () => {
      resetFlow();
      const r = await weatherReview(selectedGroupId, simulateRisk);
      setForecast(r.weatherCheck);
      loadAlerts();
      if (r.run?.status === "waiting_input" && r.run.interrupt?.type === "weather_confirmation") setWeatherPrompt(r.run);
      else setOutcome("clear");
      return r;
    });

  // 「그래도 진행할까요?」 — keep: 유지 / alternatives: 대체 축제 목록(같은 자리)
  const decideWeather = (weatherDecision) =>
    act(weatherDecision, async () => {
      const res = await resumeAgentRun(weatherPrompt.runId, { checkpointId: weatherPrompt.checkpointId, weatherDecision });
      setWeatherPrompt(null);
      // 모임장 본인 알림이 있으면 같은 답으로 맞춰 둔다 (실패해도 흐름에는 영향 없음)
      const mine = alerts.find((a) => a.groupId === selectedGroupId && !a.choice);
      if (mine) await answerAlert(mine.id, weatherDecision === "keep" ? "continue" : "find_alternative").catch(() => null);
      loadAlerts();
      if (weatherDecision === "keep") setOutcome("keep");
      else {
        setShowAllAlternatives(false);
        setAlternativeRun(res);
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

  // 유지 후에도 대체 축제를 보고 싶을 때
  const recommendAlternatives = () =>
    act("recommend", async () => {
      const r = await riskResponseForGroup(selectedGroupId);
      setOutcome(null);
      setAlternativeRun(r);
      return r;
    });

  const chooseAlternative = (f) =>
    act(`choose:${f.id}`, async () => {
      const r = await selectAlternative(alternativeRun.runId, f.id, alternativeDate(f));
      setChosen(f);
      setScheduleRun(r);
      return r;
    });

  const decideScheduleChange = (decision) =>
    act(decision, async () => {
      const r = await decideSchedule(scheduleRun, decision);
      setScheduleRun(r);
      if (decision === "approve") setReloadKey((k) => k + 1);
      if (decision === "reject") setNotice("변경하지 않았어요. 기존 축제와 일정은 그대로예요.");
      return r;
    });

  function selectGroup(id) {
    setGroupId(id);
    resetFlow();
  }

  const memberAlerts = alerts.filter((a) => a.type === "rain" && a.status !== "dismissed" && !myGroups.some((g) => g.id === a.groupId));
  const answerAsMember = (alert, choice) => act(`ans:${alert.id}`, () => answerAlert(alert.id, choice).then(loadAlerts));
  const reloadSchedule = () => setReloadKey((key) => key + 1);
  const returnToAlternatives = () => setScheduleRun(null);
  const toggleAlternatives = () => setShowAllAlternatives((shown) => !shown);

  return {
    loading: groups === null,
    memberAlerts, myGroups, selectedGroupId, detail, schedule, selectedFestival, items, day, startTime, endTime,
    forecast, forecastStatus, weatherPrompt, outcome, alternativeRun, chosen, scheduleRun, showAllAlternatives,
    riskOn, busy, notice,
    selectGroup, reviewWeather, decideWeather, recommendAlternatives, chooseAlternative, decideScheduleChange,
    returnToAlternatives, toggleAlternatives, toggleRisk, reloadSchedule, answerAsMember,
  };
}
