// 공동 일정 — 실제 API 버전 (플로우: 참여 승인 → 일정 초안 → 검증·자가 수정 → 모임장 승인 → 확정)
// v3 화면: 모임 카드 → 한 장 카드(왼쪽 확정 일정·AI 초안 | 오른쪽 검증·자가 수정 기록·기존/새 비교)
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { getGroup, listGroups } from "../../groups/api/groupsApi.js";
import { decideSchedule, draftSchedule, getSchedule } from "../api/scheduleApi.js";

const ERROR_TEXT = {
  LEADER_ONLY: "모임장만 일정을 만들 수 있어요.",
  CHECKPOINT_STALE: "일정 상태가 바뀌었어요. 초안을 다시 만들어 주세요.",
  RUN_NOT_WAITING: "이미 처리된 초안이에요.",
  GROUP_MEMBER_ONLY: "모임 참여자만 일정을 볼 수 있어요.",
};
const msg = (e) => ERROR_TEXT[e.code] || e.message || "요청에 실패했어요.";
const REPAIR_KO = { regenerate: "조건을 반영해 다시 생성", refresh_tools: "최신 정보로 다시 조회", ask_user: "사용자에게 추가 확인", stop: "중단" };
const STEPS = ["참여 확정", "AI 초안", "검증·수정", "모임장 확정"];
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (d) => {
  if (!d) return "";
  const t = new Date(`${d}T00:00:00`);
  return `${t.getMonth() + 1}/${t.getDate()}(${WD[t.getDay()]})`;
};

// 세로 타임라인: 시작 시각(굵게)·끝 시각(작게) | 점·선 | 활동·설명
// changedKeys(기존 일정의 활동|시각 묶음)가 있으면 기존에 없던 항목에 「변경」 배지
function Timeline({ items, changedKeys }) {
  if (!items?.length) return <p className="sc-empty-line">아직 확정된 일정이 없어요.</p>;
  return (
    <ol className="sc-tl">
      {items.map((x, i) => {
        const changed = !!changedKeys?.size && !changedKeys.has(`${x.label}|${x.time}`);
        return (
          <li key={i}>
            <span className="sc-tl-time">
              <b>{x.time}</b>
              {x.endTime ? <small>~{x.endTime}</small> : null}
            </span>
            <span className="sc-tl-body">
              <b>
                {x.label}
                {changed ? <em className="sc-chg">변경</em> : null}
              </b>
              {x.date || x.description || x.desc ? (
                <small>
                  {x.date ? `${dayLabel(x.date)}${x.description || x.desc ? " · " : ""}` : ""}
                  {x.description || x.desc || ""}
                </small>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
// 비교용 한 줄 목록: 「시각 · 활동명」, 바뀐 줄만 코랄
function CompactList({ items, changedKeys }) {
  if (!items?.length) return <p className="sc-empty-line">일정 없음</p>;
  return (
    <ul className="sc-mini">
      {items.map((x, i) => {
        const changed = !!changedKeys?.size && !changedKeys.has(`${x.label}|${x.time}`);
        return (
          <li key={i} className={changed ? "chg" : ""} title={`${x.time}${x.endTime ? `~${x.endTime}` : ""} ${x.label}`}>
            <b>{x.time}</b>
            <span>{x.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
// 기존 일정의 (활동|시각) 묶음 — 새 초안에서 이 묶음에 없는 항목은 바뀐 것으로 표시
const keysOf = (items) => new Set((items || []).map((x) => `${x.label}|${x.time}`));

export default function LiveSchedule({ festivals, onFail }) {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [groups, setGroups] = useState(null);
  const [group, setGroup] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [run, setRun] = useState(null); // 일정 초안 에이전트 실행 결과
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const groupId = params.get("groupId") || groups?.[0]?.id;
  const festival = (id) => festivals.find((f) => f.id === id);

  useEffect(() => {
    listGroups()
      .then(setGroups)
      .catch((e) => {
        console.warn("[schedule] 모임 목록 실패 → 데모", e);
        onFail?.();
      });
  }, [onFail]);

  const load = useCallback(async () => {
    if (!groupId) return;
    setGroup(null);
    setSchedule(null);
    try {
      const g = await getGroup(groupId);
      setGroup(g);
      if (me && g.members.some((m) => m.userId === me.id)) setSchedule(await getSchedule(groupId));
    } catch (e) {
      setNotice(msg(e));
    }
  }, [groupId, me]);
  useEffect(() => {
    setRun(null);
    setNotice("");
    load();
  }, [load]);

  async function act(fn, done) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await fn();
      if (res && res.runId) setRun(res);
      if (done) setNotice(done(res));
    } catch (e) {
      console.warn("[schedule] 실패", e);
      setNotice(msg(e));
    } finally {
      setBusy(false);
    }
  }

  // 머리글: 제목·설명 왼쪽, 진행 단계 오른쪽 (doneCount는 아래에서 계산, 로딩 중엔 0)
  const head = (done) => (
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

  if (!groups)
    return (
      <>
        {head(0)}
        <div className="empty">모임 불러오는 중…</div>
      </>
    );
  if (!groups.length)
    return (
      <>
      {head(0)}
      <div className="sc-lock">
        <i className="ti ti-calendar-off" aria-hidden="true" />
        <b>아직 참여한 모임이 없어요</b>
        <span>동행 커뮤니티에서 모임에 참여하면 공동 일정을 볼 수 있어요.</span>
        <button type="button" className="btn primary" onClick={() => navigate("/groups")}>
          동행 커뮤니티로 가기 →
        </button>
      </div>
      </>
    );

  const isLeader = group && me && group.leaderId === me.id;
  const isMember = group && me && group.members.some((m) => m.userId === me.id);
  const attempts = run?.candidateHistory || [];
  const repaired = attempts.length > 1;
  const f = group ? festival(group.festivalId) : null;

  // 진행 단계: 참여 확정 → 초안 → 검증 통과(승인 대기) → 확정
  const doneCount = !isMember ? 0 : run?.status === "completed" ? 4 : run?.status === "waiting_approval" ? 3 : run ? 2 : 1;

  const before = run?.comparison?.before?.items;
  const after = run?.comparison?.after?.items || run?.candidate?.items;
  const beforeKeys = keysOf(before);

  return (
    <>
      {head(doneCount)}

      {/* 모임 카드 */}
      <div className="sc-group">
        <div className="sc-group-ico">
          <i className="ti ti-users" aria-hidden="true" />
        </div>
        <div className="sc-group-info">
          {group ? (
            <>
              <h3>
                {group.title}
                <span className={`cm-badge ${group.status === "open" ? "open" : "closed"}`}>{group.status === "open" ? "모집 중" : "모집 마감"}</span>
              </h3>
              <div className="sc-group-meta">
                <span>
                  <i className="ti ti-confetti" aria-hidden="true" /> {f?.name || group.festivalId}
                </span>
                {group.date ? (
                  <span>
                    <i className="ti ti-calendar" aria-hidden="true" /> {dayLabel(group.date)}
                    {group.startTime ? ` · ${group.startTime.slice(0, 5)}` : ""}
                  </span>
                ) : null}
                <span>
                  <i className="ti ti-user-check" aria-hidden="true" /> 참여 확정 {group.memberCount}/{group.capacity}명
                </span>
              </div>
              <div className="cm-members sc-members">
                {group.members.map((m) => (
                  <span key={m.userId} className={m.role === "leader" ? "leader" : ""}>
                    {m.role === "leader" ? <i className="ti ti-crown" aria-hidden="true" /> : null}
                    {m.user.displayName}
                  </span>
                ))}
                {isMember ? (
                  <button type="button" className="btn small" onClick={() => navigate(`/chat?groupId=${encodeURIComponent(group.id)}`)}>
                    <i className="ti ti-message-circle" aria-hidden="true" /> 채팅방
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <h3>모임 불러오는 중…</h3>
          )}
        </div>
        <label className="sc-group-change">
          <span>모임 변경</span>
          <select value={groupId || ""} onChange={(e) => setParams({ groupId: e.target.value })} aria-label="모임 변경">
            {groups.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
                {me && x.leaderId === me.id ? " (내가 모임장)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!group ? null : !isMember ? (
        <div className="sc-lock">
          <i className="ti ti-lock" aria-hidden="true" />
          <b>참여가 확정된 사람만 볼 수 있어요</b>
          <span>동행 커뮤니티에서 참여를 신청하고, 모임장 승인을 받으면 공동 일정이 열려요.</span>
          <button type="button" className="btn primary" onClick={() => navigate(`/groups?groupId=${encodeURIComponent(group.id)}`)}>
            커뮤니티에서 참여 신청하기 →
          </button>
        </div>
      ) : (
        <div className="sc-card">
          {/* 왼쪽: 확정 일정 + AI 초안 */}
          <section className="sc-main">
            <h2 className="sc-h">현재 확정 일정</h2>
            <Timeline items={schedule?.items} />

            {notice && (
              <div className="cm-notice" role="status">
                {notice}
              </div>
            )}

            {/* 에이전트 초안 (승인 전에는 확정되지 않음) */}
            {run && run.status === "waiting_approval" && (
              <div className="sc-draft">
                <div className="sc-draft-head">
                  <b>AI 일정 초안</b>
                  <span className="cm-badge open">
                    <i className="ti ti-circle-check" aria-hidden="true" /> 검증 통과
                  </span>
                </div>
                <p>{run.candidate?.summary || "참여자 가능 시간과 운영시간을 반영한 일정"} · 모임장이 확정하기 전에는 바뀌지 않아요.</p>
                <Timeline items={run.candidate?.items} changedKeys={beforeKeys} />
                {isLeader ? (
                  <div className="sc-draft-btns">
                    <button type="button" className="btn primary" disabled={busy} onClick={() => act(() => decideSchedule(run, "approve")).then(load)}>
                      이 일정으로 확정하기
                    </button>
                    <button type="button" className="btn" disabled={busy} onClick={() => act(() => decideSchedule(run, "reject"), () => "초안을 거절했어요. 기존 일정은 그대로예요.")}>
                      거절
                    </button>
                  </div>
                ) : (
                  <div className="cm-state wait">모임장이 확정하면 일정에 반영돼요</div>
                )}
              </div>
            )}
            {run && run.status === "completed" && (
              <div className="cm-state ok sc-gap">
                <i className="ti ti-circle-check" aria-hidden="true" /> 일정을 확정했어요! 참여자에게 공유돼요.
              </div>
            )}
            {run && ["failed", "waiting_input", "rejected", "cancelled"].includes(run.status) && (
              <div className="sc-fail">
                <b>
                  <i className="ti ti-alert-triangle" aria-hidden="true" /> 초안을 확정하지 못했어요
                </b>
                <span>{run.errors?.[0]?.message || run.interrupt?.message || run.result?.summary || run.status}</span>
              </div>
            )}

            {/* 초안 승인 대기 중에는 확정/거절만 보이도록 다시 만들기 버튼을 숨긴다 */}
            {run?.status === "waiting_approval" ? null : isLeader ? (
              <button type="button" className="btn primary sc-make" disabled={busy} onClick={() => act(() => draftSchedule(group.id))}>
                <i className="ti ti-sparkles" aria-hidden="true" />
                {busy ? "AI가 일정을 만드는 중…" : run ? "AI 일정 초안 다시 만들기" : "AI 일정 초안 만들기"}
              </button>
            ) : (
              <div className="cm-state wait sc-gap">일정 초안은 모임장이 만들고 확정해요</div>
            )}
          </section>

          {/* 오른쪽: 검증·자가 수정 기록 + 기존/새 비교 (발표 핵심) */}
          <section className="sc-side">
            {!run ? (
              <>
                <h2 className="sc-h">AI 일정 검증</h2>
                <p className="sc-sub">AI가 모두 가능한 일정을 만들고, 스스로 검증해요.</p>
                <ol className="how-steps path sc-how">
                  {[
                    ["ti-sparkles", "초안 만들기", "참여자 가능 시간과 축제 운영시간을 반영해요"],
                    ["ti-shield-check", "스스로 검증", "시간이 겹치거나 빠진 사람이 없는지 확인해요"],
                    ["ti-refresh", "실패하면 고쳐서 다시", "원인을 분석해 고친 뒤 다시 검증해요"],
                    ["ti-crown", "모임장 확정", "모임장이 확정해야 일정에 반영돼요"],
                  ].map(([icon, title, desc], i) => (
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
        </div>
      )}
    </>
  );
}
