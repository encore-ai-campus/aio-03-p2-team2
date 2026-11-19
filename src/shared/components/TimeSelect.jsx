// 시각 선택 (시 · 분) — 분은 10분 단위로만 고른다 (11/19)
// 기본 <input type="time">은 분을 1분 단위로 골라야 해서 스크롤이 길었다.
// 값 형식은 그대로 "HH:MM" 문자열, onChange도 기존 input과 같은 { target: { value } } 형태로 넘긴다.
import "./timeSelect.css";

const pad = (n) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));
const MINUTES = ["00", "10", "20", "30", "40", "50"];

export default function TimeSelect({ id, value = "", onChange, disabled = false, className = "" }) {
  const [hh = "", mm = ""] = String(value || "").slice(0, 5).split(":");
  const hour = HOURS.includes(hh) ? hh : "";
  const minute = hour ? mm || "00" : "";
  // 예전에 저장된 값이 10분 단위가 아니면(예: 14:05) 지우지 않고 목록에 그대로 보여 준다
  const minutes = minute && !MINUTES.includes(minute) ? [...MINUTES, minute].sort() : MINUTES;
  const emit = (next) => onChange?.({ target: { value: next } });

  return (
    <span className={`time-select ${className}`.trim()}>
      <select
        id={id}
        aria-label="시"
        value={hour}
        disabled={disabled}
        onChange={(e) => emit(e.target.value ? `${e.target.value}:${minute || "00"}` : "")}
      >
        <option value="">시</option>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}시
          </option>
        ))}
      </select>
      <select
        id={id ? `${id}-min` : undefined}
        aria-label="분"
        value={minute}
        disabled={disabled || !hour}
        onChange={(e) => emit(`${hour}:${e.target.value || "00"}`)}
      >
        {!hour && <option value="">분</option>}
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}분
          </option>
        ))}
      </select>
    </span>
  );
}
