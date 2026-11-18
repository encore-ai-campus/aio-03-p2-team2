import HourlyTable from "./HourlyTable.jsx";

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

export default function AlertForecast({ forecast, forecastStatus, day, startTime, endTime, hasSchedule, selectedFestival, selectedGroupId, busy, reviewWeather }) {
  const data = forecast?.weather?.data;
  const look = weatherLook(data?.weatherCode);
  const hourly = (data?.hourly || []).slice(0, 8);
  // 시뮬레이션·데모는 시간별 값이 없어서 모임 시간대를 같은 값으로 채운다 (출처 줄에 「시연용」 표시)
  const hours = hourly.length
    ? hourly
    : data && startTime
      ? Array.from({ length: Math.max(1, Number((endTime || startTime).slice(0, 2)) - Number(startTime.slice(0, 2)) + 1) }, (_, i) => {
          const hh = String(Number(startTime.slice(0, 2)) + i).padStart(2, "0");
          return { time: `${data.date || day}T${hh}:00`, precipitationProbability: data.precipitationProbability, weatherCode: data.weatherCode };
        })
      : [];
  const rainHours = hours.filter((h) => (h.precipitationProbability ?? 0) >= 60).length;
  const maxWind = hours.reduce((m, h) => (h.windSpeed != null && h.windSpeed > m ? h.windSpeed : m), data?.windSpeed ?? -1);
  const isSim = forecast?.isTest || forecast?.weather?.mode === "simulation";
  const srcLabel = isSim ? "시연용 비 예보" : forecast?.weather?.mode === "demo" ? "데모 날씨" : `${forecast?.weather?.source || "날씨 예보"} 실시간 예보`;
  const region = selectedFestival ? [selectedFestival.region, selectedFestival.city].filter(Boolean).join(" ") : "";
  return (
    <section className="al-weather">
      <div className="al-card-h">
        <h2 className="sc-h">모임 시간 날씨</h2>
        {forecast ? (
          <span className={`al-src${isSim ? " sim" : ""}`}>
            <i className={`ti ${isSim ? "ti-flask" : "ti-circle-check"}`} aria-hidden="true" />
            {srcLabel}
          </span>
        ) : null}
      </div>
      {!forecast ? (
        <div className="al-wx-empty">
          <i className={`ti ${forecastStatus === "loading" ? "ti-loader-2 al-spin" : "ti-cloud"}`} aria-hidden="true" />
          <b>{forecastStatus === "loading" ? "실제 예보를 불러오는 중…" : forecastStatus ? "예보를 불러오지 못했어요" : hasSchedule ? "날씨를 불러올 준비 중이에요" : "확정된 일정이 없어요"}</b>
          <span>{forecastStatus && forecastStatus !== "loading" ? forecastStatus : hasSchedule ? "모임 날짜·시간·장소 기준으로 실제 예보를 보여 드려요." : "공동 일정을 확정하면 그 날짜의 예보를 보여 드려요."}</span>
        </div>
      ) : (
        <>
          <div className="al-wx-top">
            <div className={`al-wx-main ${look.tone}`}>
              <span className="al-wx-ico">
                <i className={`ti ${look.icon}`} aria-hidden="true" />
              </span>
              <div>
                <small>최대 강수확률</small>
                <b>{data?.precipitationProbability != null ? `${data.precipitationProbability}%` : "–"}</b>
                <span>{look.label}</span>
              </div>
            </div>
            <div className="al-chips">
              <div className="al-chip">
                <small>비 예보 시간</small>
                <b>
                  {rainHours}
                  <em>/ {hours.length || 0}시간</em>
                </b>
              </div>
              <div className="al-chip">
                <small>최대 바람</small>
                <b>
                  {maxWind >= 0 ? maxWind : "–"}
                  <em>{data?.windSpeedUnit || "m/s"}</em>
                </b>
              </div>
              <div className="al-chip">
                <small>판단 기준</small>
                <b>
                  60%<em>이상</em>
                </b>
              </div>
            </div>
          </div>
          <HourlyTable hours={hours} look={weatherLook} />
        </>
      )}
      {/* 주 행동(진행 여부 정하기)은 위 결론 띠 하나에만. 여기는 출처·보조 행동 */}
      <div className="al-wx-foot">
        <span>
          {forecast?.weather?.fetchedAt ? `${fetchedTime(forecast.weather.fetchedAt)} 업데이트` : forecast ? "방금 확인" : ""}
          {forecast && region ? ` · ${region} 기준` : ""}
        </span>
        <div className="al-wx-links">
          <button type="button" className="al-link" disabled={!!busy || !selectedGroupId || !hasSchedule} onClick={() => reviewWeather(false)}>
            <i className="ti ti-refresh" aria-hidden="true" /> {busy === "check" ? "확인하는 중…" : "다시 확인"}
          </button>
          <button
            type="button"
            className="al-link al-sim"
            disabled={!!busy || !selectedGroupId || !hasSchedule}
            onClick={() => reviewWeather(true)}
            title="시연용으로 비 예보를 만들어 확인해요. 참여자에게 [테스트] 알림이 함께 가요."
          >
            {busy === "sim" ? "만드는 중…" : "시연용: 비 예보 만들기"}
          </button>
        </div>
      </div>
    </section>
  );
}
