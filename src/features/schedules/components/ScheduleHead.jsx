// 머리글: 제목·설명 왼쪽, 진행 단계 오른쪽 (done = 끝난 단계 수, 로딩 중엔 0)
import { STEPS } from "../lib/scheduleFormat.js";

export default function ScheduleHead({ done }) {
  return (
    <div className="mp-head">
      <div>
        <h1>공동 일정</h1>
        <p>AI가 모두 가능한 일정을 만들고 스스로 검증해요. 확정은 모임장이 해요</p>
      </div>
      <ol className="mp-steps" aria-label="일정 진행 단계">
        {STEPS.map((x, i) => {
          const cls = i < done ? "done" : i === done ? "cur" : "";
          return (
            <li key={x} className={cls}>
              {i < done ? <i className="ti ti-circle-check" aria-hidden="true" /> : <span>{String(i + 1).padStart(2, "0")}</span>}
              {x}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
