// 동행 커뮤니티 — 실제 API 버전 (GET /groups → 상세 GET /groups/{id})
// 1단계 게시판 목록(?groupId 없음) → 글을 누르면 2단계 상세(?groupId=…)
// 참여 신청(POST join-requests) · 모임장 승인/거절(version 포함) · 공개 댓글
// 모임장 판단은 GET /me 의 users.id 와 group.leaderId 비교 (JWT sub와 다름)
// 목록 API가 실패하면 onFail()로 CommunityPage가 기존 데모 화면을 보여준다.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { addComment, approveJoin, getGroup, listGroups, listJoinRequests, rejectJoin, requestJoin } from "../api/groupsApi.js";
import LiveNewGroupModal from "./LiveNewGroupModal.jsx";

const ERROR_TEXT = {
  ALREADY_MEMBER: "이미 참여 중인 모임이에요.",
  JOIN_REQUEST_ALREADY_EXISTS: "이미 참여 신청을 했어요. 모임장 승인을 기다려 주세요.",
  GROUP_CLOSED: "모집이 마감된 모임이에요.",
  GROUP_CAPACITY_EXCEEDED: "정원이 가득 찼어요.",
  RESOURCE_VERSION_CONFLICT: "모임 정보가 바뀌었어요. 다시 시도해 주세요.",
  JOIN_REQUEST_NOT_PENDING: "이미 처리된 신청이에요.",
  LEADER_ONLY: "모임장만 할 수 있어요.",
};
const msg = (e) => ERROR_TEXT[e.code] || e.message || "요청에 실패했어요.";
const STATUS = { open: ["모집 중", "open"], full: ["정원 마감", "closed"], closed: ["모집 마감", "closed"], cancelled: ["취소됨", "closed"] };
const shortId = (id) => (id ? id.replace(/^usr_/, "").slice(0, 6) : "?");
const SORTS = [
  ["latest", "최신순"],
  ["soon", "일정 가까운 순"],
  ["seats", "남은 자리 많은 순"],
  ["members", "인원 많은 순"],
];
const FILTERS = [
  ["all", "전체"],
  ["open", "모집 중"],
  ["closed", "마감"],
];

// 배지: 상태·참여 방식·내 모임
const StatusBadge = ({ status }) => {
  const [label, tone] = STATUS[status] || [status, "closed"];
  return <span className={`cm-badge ${tone}`}>{label}</span>;
};
const JoinBadge = ({ mode }) => <span className={`cm-badge ${mode === "approval" ? "approval" : "instant"}`}>{mode === "approval" ? "승인제" : "바로 참여"}</span>;
const MineBadge = () => (
  <span className="cm-badge mine">
    <i className="ti ti-crown" aria-hidden="true" /> 내 모임
  </span>
);

export default function LiveCommunity({ festivals, onFail, newOpen, onCloseNew }) {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("groupId");
  const filter = params.get("status") || "all";
  const sort = SORTS.some(([v]) => v === params.get("sort")) ? params.get("sort") : "latest";
  const [groups, setGroups] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [joinMsg, setJoinMsg] = useState("");
  const [comment, setComment] = useState("");
  const [requests, setRequests] = useState([]); // 모임장일 때만 불러오는 대기 신청 목록
  const [requested, setRequested] = useState(() => new Set()); // 내가 이번에 신청한 모임 (상세 응답엔 신청 목록이 없음)
  const festival = (id) => festivals.find((f) => f.id === id);
  const [created, setCreated] = useState(""); // 방금 만든 모집글 id → 상세에 안내

  // 「＋ 직접 모임 만들기」 완료 → 창 닫고 새 글 상세로 이동, 목록 새로 불러오기
  const onCreated = (group) => {
    onCloseNew?.();
    setCreated(group.id);
    setParams({ groupId: group.id });
    window.scrollTo(0, 0);
    loadList();
  };
  const newModal = newOpen ? <LiveNewGroupModal festivals={festivals} onClose={onCloseNew} onCreated={onCreated} /> : null;

  // 상세에서 확인한 최신 값(인원·신청 대기) — 목록 API 값이 늦게 반영돼도 목록에 덮어쓴다
  const patchRef = useRef(null);
  const applyPatch = (list) => {
    const p = patchRef.current;
    return p ? list?.map((x) => (x.id === p.id ? { ...x, ...p } : x)) : list;
  };
  const loadList = useCallback(
    () =>
      listGroups()
        .then((list) => setGroups(applyPatch(list)))
        .catch((e) => {
          console.warn("[groups] 목록 API 실패 → 데모", e);
          onFail?.();
        }),
    [onFail],
  );
  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    () =>
      selectedId
        ? getGroup(selectedId)
            .then(async (group) => {
              setDetail(group);
              // 신청 목록은 상세에 없어서 모임장일 때만 따로 조회
              const reqs = me && group.leaderId === me.id ? await listJoinRequests(group.id) : [];
              setRequests(reqs);
              patchRef.current = {
                id: group.id,
                memberCount: group.memberCount,
                capacity: group.capacity,
                status: group.status,
                ...(me && group.leaderId === me.id ? { pendingRequestCount: reqs.length } : {}),
              };
              setGroups(applyPatch);
            })
            .catch((e) => setNotice(msg(e)))
        : null,
    [selectedId, me],
  );
  useEffect(() => {
    setDetail(null);
    setNotice("");
    setJoinMsg("");
    setComment("");
    loadDetail();
  }, [loadDetail]);

  // 처리 후 목록·상세 다시 불러오기
  async function act(fn, done) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await fn();
      if (done) setNotice(done);
      await Promise.all([loadList(), loadDetail()]);
    } catch (e) {
      console.warn("[groups] 요청 실패", e);
      setNotice(msg(e));
      if (e.code === "RESOURCE_VERSION_CONFLICT") loadDetail();
    } finally {
      setBusy(false);
    }
  }

  // 필터·정렬은 주소에 남겨서 「목록으로」를 눌러도 유지
  const listParams = (next = {}) => {
    const st = next.status ?? filter;
    const so = next.sort ?? sort;
    return { ...(st !== "all" ? { status: st } : {}), ...(so !== "latest" ? { sort: so } : {}) };
  };
  const keepFilter = listParams();
  const openGroup = (id) => {
    setParams({ ...keepFilter, groupId: id });
    window.scrollTo(0, 0);
  };
  const backToList = () => setParams(keepFilter);

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : "");
  const md = (d) => (d ? d.slice(5).replace("-", ".") : "");
  const when = (item, f) => (item.date ? md(item.date) : f ? `${md(f.start)}–${md(f.end || f.start)}` : "-");
  const where = (f) => (f ? [f.region, f.city].filter(Boolean).join(" ") || "지역 미정" : "지역 미정");
  const pct = (item) => Math.min(100, ((item.memberCount || 0) / (item.capacity || 1)) * 100);

  if (!groups)
    return (
      <>
        <div className="empty">모임 불러오는 중…</div>
        {newModal}
      </>
    );

  // ===== 2단계: 글 상세 =====
  if (selectedId) {
    const g = detail;
    const isLeader = g && me && g.leaderId === me.id;
    const isMember = g && me && g.members.some((m) => m.userId === me.id);
    const myPending = g && requested.has(g.id);
    const pending = isLeader ? requests : [];
    const f = g ? festival(g.festivalId) : null;

    return (
      <div className="cm-detail-page">
        {newModal}
        <button type="button" className="cm-back" onClick={backToList}>
          <i className="ti ti-arrow-left" aria-hidden="true" /> 목록으로
        </button>
        {!g ? (
          <div className="empty">{notice || "모임 불러오는 중…"}</div>
        ) : (
          <div className="cm-detail">
            {/* 왼쪽: 본문·댓글 */}
            <article className="cm-post">
              <div className="cm-badges">
                <StatusBadge status={g.status} />
                <JoinBadge mode={g.joinMode} />
                {isLeader ? <MineBadge /> : null}
              </div>
              <h2 className="cm-post-title">{g.title}</h2>
              <div className="cm-meta">
                <span>
                  <i className="ti ti-confetti" aria-hidden="true" /> {f?.name || g.festivalId}
                </span>
                <span>
                  <i className="ti ti-map-pin" aria-hidden="true" /> {where(f)}
                </span>
                <span>
                  <i className="ti ti-calendar" aria-hidden="true" /> {when(g, f)}
                  {g.startTime ? ` · ${g.startTime.slice(0, 5)} 합류` : ""}
                </span>
              </div>
              <div className="cm-body">{g.postBody}</div>

              <div className="cm-comments">
                <div className="cm-comments-head">
                  <h3>
                    공개 댓글 <span>{g.comments.length}</span>
                  </h3>
                  <span className="cm-badge instant">참여 전에도 공개</span>
                </div>
                {g.comments.length ? (
                  g.comments.map((c) => (
                    <div className="cm-comment" key={c.id}>
                      <span className="cm-ava">{(c.author.displayName || "?").slice(0, 1)}</span>
                      <div>
                        <strong>{c.author.displayName}</strong>
                        <span className="cm-time"> · {fmt(c.createdAt)}</span>
                        <p>{c.text}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="cm-empty-line">첫 공개 댓글을 남겨 보세요.</p>
                )}
                {me && (
                  <form
                    className="cm-comment-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (comment.trim()) act(() => addComment(g.id, comment.trim())).then(() => setComment(""));
                    }}
                  >
                    <input maxLength={500} placeholder="공개 댓글로 인사하거나 참여 의사를 밝혀 보세요" aria-label="공개 댓글" value={comment} onChange={(e) => setComment(e.target.value)} />
                    <button type="submit" className="btn small" disabled={busy || !comment.trim()}>
                      댓글 등록
                    </button>
                  </form>
                )}
              </div>
            </article>

            {/* 오른쪽: 모집 현황 (스크롤 따라오지 않음) */}
            <aside className="cm-side">
              <h3>모집 현황</h3>
              <div className="cm-row">
                <span>인원</span>
                <b>
                  {g.memberCount} / {g.capacity}명
                </b>
              </div>
              <div className="cm-bar">
                <div style={{ width: pct(g) + "%" }} />
              </div>
              <div className="cm-members">
                {g.members.map((m) => (
                  <span key={m.userId} className={m.role === "leader" ? "leader" : ""}>
                    {m.role === "leader" ? <i className="ti ti-crown" aria-hidden="true" /> : null}
                    {m.user.displayName}
                  </span>
                ))}
              </div>
              <div className="cm-row">
                <span>참여 방식</span>
                <span>{g.joinMode === "approval" ? "모임장 승인 후 참여" : "바로 참여"}</span>
              </div>
              <div className="cm-row">
                <span>상태</span>
                <span>{g.status === "open" ? "참여 신청 가능" : "모집 종료 (게시글 유지)"}</span>
              </div>

              {created === g.id && !notice ? (
                <div className="cm-notice ok" role="status">
                  <i className="ti ti-circle-check" aria-hidden="true" /> 모집글이 올라갔어요. 참여 신청이 오면 여기서 승인할 수 있어요.
                </div>
              ) : null}
              {notice && (
                <div className="cm-notice" role="status">
                  {notice}
                </div>
              )}

              {/* 내 상태에 따라 버튼 하나만 */}
              <div className="cm-action">
                {isLeader || isMember ? (
                  <>
                    {isLeader ? null : (
                      <div className="cm-state ok">
                        <i className="ti ti-circle-check" aria-hidden="true" /> 참여 확정
                      </div>
                    )}
                    {/* 플로우 다음 단계: 참여 확정 → 공동 일정 */}
                    <button type="button" className="btn primary cm-cta" onClick={() => navigate(`/schedules?groupId=${encodeURIComponent(g.id)}`)}>
                      <i className="ti ti-calendar-event" aria-hidden="true" /> 공동 일정 {isLeader ? "만들기" : "보기"} →
                    </button>
                    <button type="button" className="btn cm-cta" onClick={() => navigate(`/chat?groupId=${encodeURIComponent(g.id)}`)}>
                      <i className="ti ti-message-circle" aria-hidden="true" /> 모임 채팅방 →
                    </button>
                  </>
                ) : myPending ? (
                  <div className="cm-state wait">
                    <i className="ti ti-hourglass" aria-hidden="true" /> 승인 대기 중
                  </div>
                ) : g.status !== "open" ? (
                  <div className="cm-state off">모집이 마감됐어요</div>
                ) : (
                  <>
                    {me && g.joinMode === "approval" && (
                      <input
                        className="cm-join-msg"
                        maxLength={300}
                        placeholder="모임장에게 한마디 (선택) · 예) 오후 3시부터 참여 가능해요"
                        aria-label="신청 메시지"
                        value={joinMsg}
                        onChange={(e) => setJoinMsg(e.target.value)}
                      />
                    )}
                    <button
                      type="button"
                      className="btn primary cm-cta"
                      disabled={busy || !me}
                      onClick={() =>
                        act(
                          () =>
                            requestJoin(g.id, joinMsg)
                              .then(() => setRequested((s) => new Set(s).add(g.id)))
                              .catch((e) => {
                                if (e.code === "JOIN_REQUEST_ALREADY_EXISTS") setRequested((s) => new Set(s).add(g.id));
                                throw e;
                              }),
                          g.joinMode === "approval" ? "참여 신청을 보냈어요. 모임장 승인을 기다려 주세요." : "모임에 참여했어요!",
                        ).then(() => setJoinMsg(""))
                      }
                    >
                      {g.joinMode === "approval" ? "참여 신청하기" : "바로 참여하기"}
                    </button>
                  </>
                )}
              </div>

              {isLeader && (
                <div className="cm-requests">
                  <h4>승인 대기 {pending.length}명</h4>
                  {pending.length ? (
                    pending.map((r) => (
                      <div className="cm-request" key={r.id}>
                        <div>
                          <strong>신청자 #{shortId(r.userId)}</strong>
                          <small>
                            {r.message ? `“${r.message}” · ` : ""}
                            {fmt(r.createdAt)}
                          </small>
                        </div>
                        <div className="cm-request-btns">
                          <button type="button" className="btn small green" disabled={busy} onClick={() => act(() => approveJoin(g.id, r.id, g.version), "승인했어요. 참여가 확정됐어요! 이제 ‘공동 일정 만들기’로 참여자 조건에 맞는 일정을 만들 수 있어요.")}>
                            승인
                          </button>
                          <button type="button" className="btn small" disabled={busy} onClick={() => act(() => rejectJoin(g.id, r.id, g.version), "거절했어요. 신청자에게 안내돼요.")}>
                            거절
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="cm-empty-line">아직 대기 중인 신청이 없어요.</p>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    );
  }

  // ===== 1단계: 게시판 목록 =====
  // 정렬 기준: 일정 = 모임 날짜(없으면 축제 시작일), 남은 자리 = 정원 − 현재 인원
  const dayOf = (x) => x.date || festival(x.festivalId)?.start || "9999-12-31";
  const seatsOf = (x) => (x.capacity || 0) - (x.memberCount || 0);
  const byLatest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
  const SORT_FN = {
    latest: byLatest,
    soon: (a, b) => dayOf(a).localeCompare(dayOf(b)) || byLatest(a, b),
    seats: (a, b) => seatsOf(b) - seatsOf(a) || byLatest(a, b),
    members: (a, b) => (b.memberCount || 0) - (a.memberCount || 0) || byLatest(a, b),
  };
  const shown = groups.filter((x) => filter === "all" || (filter === "open" ? x.status === "open" : x.status !== "open")).sort(SORT_FN[sort]);
  const count = (v) => groups.filter((x) => v === "all" || (v === "open" ? x.status === "open" : x.status !== "open")).length;

  return (
    <>
      {newModal}
      <div className="cm-toolbar">
        <div className="cm-filters" role="tablist" aria-label="모집 상태">
          {FILTERS.map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={filter === v} className={filter === v ? "on" : ""} onClick={() => setParams(listParams({ status: v }))}>
              {label} <span>{count(v)}</span>
            </button>
          ))}
        </div>
        <label className="cm-sort">
          <i className="ti ti-arrows-sort" aria-hidden="true" />
          <span className="sr-only">정렬</span>
          <select value={sort} onChange={(e) => setParams(listParams({ sort: e.target.value }))} aria-label="정렬">
            {SORTS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="cm-board">
        <div className="cm-board-head" aria-hidden="true">
          <span>상태</span>
          <span>제목 · 축제</span>
          <span>일정 · 지역</span>
          <span>인원</span>
          <span>작성일</span>
        </div>
        {shown.length ? (
          shown.map((item) => {
            const f = festival(item.festivalId);
            const mine = me && item.leaderId === me.id;
            return (
              <button key={item.id} type="button" className={`cm-board-row ${item.status !== "open" ? "dim" : ""}`} onClick={() => openGroup(item.id)}>
                <span className="cm-badges">
                  <StatusBadge status={item.status} />
                  {item.status === "open" ? <JoinBadge mode={item.joinMode} /> : null}
                </span>
                <span className="cm-title-cell">
                  <b>
                    {item.title}
                    {mine ? <MineBadge /> : null}
                  </b>
                  <small>{f?.name || "축제"}</small>
                </span>
                <span className="cm-when-cell">
                  {when(item, f)}
                  <small>{where(f)}</small>
                </span>
                <span className="cm-count-cell">
                  <span>
                    {item.memberCount}/{item.capacity}명{mine && item.pendingRequestCount ? <em> · 대기 {item.pendingRequestCount}</em> : null}
                  </span>
                  <span className="cm-bar">
                    <span style={{ width: pct(item) + "%" }} />
                  </span>
                </span>
                <span className="cm-date-cell">{fmtDay(item.createdAt)}</span>
              </button>
            );
          })
        ) : (
          <div className="cm-board-empty">{filter === "all" ? "아직 모집글이 없어요. AI 동행 매칭 결과에서 모집글을 만들어 보세요." : "해당 상태의 모집글이 없어요."}</div>
        )}
      </div>
    </>
  );
}
