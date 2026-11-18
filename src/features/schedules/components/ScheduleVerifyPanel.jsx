// 한 장 카드 오른쪽: 검증·자가 수정 기록 + 기존/새 비교 (발표 핵심) — 초안 전에는 검증 절차 안내
import { REPAIR_KO } from "../lib/scheduleFormat.js";
import { CompactList } from "./ScheduleTimeline.jsx";

const HOW_STEPS = [
  ["ti-sparkles", "초안 만들기", "참여자 가능 시간과 축제 운영시간을 반영해요"],
  ["ti-shield-check", "스스로 검증", "시간이 겹치거나 빠진 사람이 없는지 확인해요"],
  ["ti-refresh", "실패하면 고쳐서 다시", "원인을 분석해 고친 뒤 다시 검증해요"],
  ["ti-crown", "모임장 확정", "모임장이 확정해야 일정에 반영돼요"],
];

export default function ScheduleVerifyPanel({ run, before, after, beforeKeys }) {
  const attempts = run?.candidateHistory || [];
  const repaired = attempts.length > 1;
  return (
    <section className="sc-side">
      {!run ? (
        <>
          <h2 className="sc-h">AI 일정 검증</h2>
          <p className="sc-sub">AI가 모두 가능한 일정을 만들고, 스스로 검증해요.</p>
          <ol className="how-steps path sc-how">
            {HOW_STEPS.map(([icon, title, desc], i) => (
              <li key={title} className={i === 0 ? "now" : ""}>
                <i className={`ti ${icon}`} aria-hidden="true" />
                <div>
                  <small>STEP {i + 1}</small>
                  <b>{title}</b>
                  <span>{desc}</span>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <div className="sc-side-head">
            <h2 className="sc-h">AI 검증·자가 수정 기록</h2>
            <span className={`cm-badge ${repaired ? "approval" : "open"}`}>{repaired ? `자가 수정 ${attempts.length - 1}회` : "첫 초안 검증 통과"}</span>
          </div>
          <ol className="sc-attempts">
            {attempts.map((a, i) => {
              const fail = a.errors?.length > 0;
              return (
                <li key={i} className={fail ? "fail" : "pass"}>
                  <span className="sc-att-dot">
                    <i className={`ti ${fail ? "ti-x" : "ti-check"}`} aria-hidden="true" />
                  </span>
                  <div>
                    <b>
                      {i + 1}차 초안 · {fail ? "검증 실패" : "검증 통과"}
                    </b>
                    {a.errors?.length ? (
                      <div className="sc-errs">
                        {a.errors.map((e, j) => (
                          <span key={j}>{e.message}</span>
                        ))}
                      </div>
                    ) : null}
                    <small>{a.repair?.action ? `수정 전략: ${REPAIR_KO[a.repair.action] || a.repair.action}${a.repair.reason ? ` — ${a.repair.reason}` : ""}` : "처음 생성한 초안"}</small>
                    {a.candidate?.items?.length > 0 && <small className="sc-att-items">{a.candidate.items.map((x) => `${x.time} ${x.label}`).join(" → ")}</small>}
                  </div>
                </li>
              );
            })}
          </ol>

          {before && (
            <div className="sc-compare">
              <h3>기존 · 새 일정 비교</h3>
              <div className="sc-compare-grid">
                <div>
                  <span className="sc-compare-tag">기존</span>
                  <CompactList items={before} />
                </div>
                <i className="ti ti-arrow-right sc-compare-arrow" aria-hidden="true" />
                <div className="new">
                  <span className="sc-compare-tag">새 초안</span>
                  <CompactList items={after} changedKeys={beforeKeys} />
                </div>
              </div>
            </div>
          )}

          <details className="sc-trace">
            <summary>🔧 에이전트 실행 과정 · 단계 {run.trace?.length || 0}개</summary>
            <pre>{(run.trace || []).map((t, i) => `${i + 1}. ${t.node}${t.tools?.length ? ` → ${t.tools.join(", ")}` : ""}${t.errorCodes?.length ? ` ⚠️ ${t.errorCodes.join(", ")}` : ""}`).join("\n")}</pre>
          </details>
        </>
      )}
    </section>
  );
}
