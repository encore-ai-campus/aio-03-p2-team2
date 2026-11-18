import { useEffect, useRef } from "react";
import useHorizontalScroll from "../../../shared/hooks/useHorizontalScroll.js";

const RAIN_LINE = 60; // 비 예보 판단 기준 (백엔드 agents/policy.py와 같은 값)

// 모임 시간대 시간별 예보 표 (네이버 날씨식: 열 = 시간, 행 = 날씨·강수확률)
// 열이 많아 넘치면 표 안에서만 가로 이동, 행 이름은 고정, 첫 비 시간으로 자동 이동
export default function HourlyTable({ hours, look }) {
  const key = hours.map((h) => h.time).join("|");
  const { ref, canLeft, canRight, scrollByPage, scrollToEl } = useHorizontalScroll([key]);
  const labelRef = useRef(null);

  useEffect(() => {
    const first = ref.current?.querySelector("td.hi");
    if (!first) return undefined;
    const t = setTimeout(() => scrollToEl(first, (labelRef.current?.offsetWidth || 0) + first.offsetWidth), 250);
    return () => clearTimeout(t);
  }, [key, ref, scrollToEl]);

  if (!hours.length) return null;
  return (
    <div className="hs">
      <div className="hs-wrap" ref={ref}>
        <table className="hourly" aria-label="모임 시간대 시간별 예보">
          <thead>
            <tr>
              <th className="lab" scope="col" ref={labelRef}>
                모임 시간
              </th>
              {hours.map((h) => (
                <th key={h.time} scope="col">
                  {String(h.time).slice(11, 13)}시
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">날씨</th>
              {hours.map((h) => {
                const l = look(h.weatherCode);
                return (
                  <td key={h.time}>
                    <span className="w">
                      <i className={`ti ${l.icon}`} aria-hidden="true" />
                      {l.label}
                    </span>
                  </td>
                );
              })}
            </tr>
            <tr>
              <th scope="row">
                강수확률<em>%</em>
              </th>
              {hours.map((h) => {
                const p = h.precipitationProbability ?? 0;
                return (
                  <td key={h.time} className={`p${p >= RAIN_LINE ? " hi" : ""}`}>
                    <b>{p}</b>
                    <span className="bar">
                      <span style={{ width: `${Math.min(100, Math.max(0, p))}%` }} />
                    </span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <span className={`hs-fade l${canLeft ? " on" : ""}`} aria-hidden="true" />
      <span className={`hs-fade r${canRight ? " on" : ""}`} aria-hidden="true" />
      <button type="button" className={`hs-btn l${canLeft ? " on" : ""}`} aria-label="이전 시간" tabIndex={canLeft ? 0 : -1} onClick={() => scrollByPage(-1)}>
        <i className="ti ti-chevron-left" aria-hidden="true" />
      </button>
      <button type="button" className={`hs-btn r${canRight ? " on" : ""}`} aria-label="다음 시간" tabIndex={canRight ? 0 : -1} onClick={() => scrollByPage(1)}>
        <i className="ti ti-chevron-right" aria-hidden="true" />
      </button>
    </div>
  );
}
