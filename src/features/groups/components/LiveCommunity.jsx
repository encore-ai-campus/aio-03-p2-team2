// 동행 커뮤니티 — 실제 API 버전 (GET /groups → 상세 GET /groups/{id})
// 참여 신청(POST join-requests) · 모임장 승인/거절(version 포함) · 공개 댓글
// 모임장 판단은 GET /me 의 users.id 와 group.leaderId 비교 (JWT sub와 다름)
// 목록 API가 실패하면 onFail()로 CommunityPage가 기존 데모 화면을 보여준다.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { addComment, approveJoin, getGroup, listGroups, listJoinRequests, rejectJoin, requestJoin } from "../api/groupsApi.js";

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
const STATUS = { open: ["모집 중", "green"], full: ["정원 마감", "dark"], closed: ["모집 마감", "dark"], cancelled: ["취소됨", "dark"] };
const shortId = (id) => (id ? id.replace(/^usr_/, "").slice(0, 6) : "?");

export default function LiveCommunity({ festivals, pill, onFail }) {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("groupId");
  const [groups, setGroups] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [joinMsg, setJoinMsg] = useState("");
  const [comment, setComment] = useState("");
  const [requests, setRequests] = useState([]); // 모임장일 때만 불러오는 대기 신청 목록
  const [requested, setRequested] = useState(() => new Set()); // 내가 이번에 신청한 모임 (상세 응답엔 신청 목록이 없음)
  const festival = (id) => festivals.find((f) => f.id === id);

  // 상세에서 확인한 최신 값(인원·신청 대기) — 목록 API 값이 늦게 반영돼도 카드에 덮어쓴다
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

  const currentId = selectedId || groups?.[0]?.id;
  const loadDetail = useCallback(
    () =>
      currentId
        ? getGroup(currentId)
            .then(async (group) => {
              setDetail(group);
              // 신청 목록은 상세에 없어서 모임장일 때만 따로 조회
              const reqs = me && group.leaderId === me.id ? await listJoinRequests(group.id) : [];
              setRequests(reqs);
              // 목록 API 값(인원·신청 대기)이 늦게 반영돼서, 선택한 모임 카드는 상세 기준으로 맞춘다
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
    [currentId, me],
  );
  useEffect(() => {
    setDetail(null);
    setNotice("");
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

  if (!groups) return <div className="empty">모임 불러오는 중…</div>;
  const shown = groups.filter((g) => filter === "all" || (filter === "open" ? g.status === "open" : g.status !== "open"));
  const g = detail;
  const isLeader = g && me && g.leaderId === me.id;
  const isMember = g && me && g.members.some((m) => m.userId === me.id);
  const myPending = g && requested.has(g.id);
  const pending = isLeader ? requests : [];

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  const period = (f) => (f ? `${f.start} ~ ${f.end}` : "-");

  // 화면 구조·클래스는 기존 데모 커뮤니티(GroupCard·GroupDetail)와 동일하게 맞춘다
  return (
    <>
      <div className="section-head">
        <div>
          <h2>
            {"모임 목록 "}
            <span className="muted sm">{shown.length}개</span>
          </h2>
          <p>생성일 최신순 · 신청 대기자·유형·정원 확인</p>
        </div>
        <div className="chips">
          {[
            ["all", "전체"],
            ["open", "모집 중"],
            ["closed", "마감"],
          ].map(([v, label]) => (
            <button key={v} type="button" className={`chip ${filter === v ? "active" : ""}`} onClick={() => setFilter(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="columns">
        <div className="room-list">
          {shown.length ? (
            shown.map((item) => {
              const f = festival(item.festivalId);
              const [label, tone] = STATUS[item.status] || [item.status, "dark"];
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`room-summary ${item.id === currentId ? "active" : ""}`}
                  onClick={() => setParams({ groupId: item.id })}
                >
                  <div className="btnrow">
                    {pill(label, tone)}
                    {pill(item.joinMode === "approval" ? "모임장 승인제" : "즉시 참여제", item.joinMode === "approval" ? "purple" : "blue")}
                    {me && item.leaderId === me.id ? pill("👑 내가 모임장", "red") : null}
                  </div>
                  <h3>{item.title}</h3>
                  <div className="metadata">
                    {"🎪 "}
                    {f?.name || "축제"}
                    {"   📍 "}
                    {f?.region || "미정"}
                    {"   📅 "}
                    {period(f)}
                  </div>
                  <div className="meter">
                    <div style={{ width: Math.min(100, (item.memberCount / item.capacity) * 100) + "%" }} />
                  </div>
                  <div className="lower">
                    <span className="tiny muted">
                      👤 {item.memberCount}/{item.capacity}명 · 신청 대기 {item.pendingRequestCount || 0}명
                    </span>
                    <span className="tiny muted">{fmt(item.createdAt)}</span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="empty">아직 모집글이 없어요. AI 동행 매칭 결과에서 모집글을 만들어 보세요.</div>
          )}
        </div>

        <article className="box pad room-detail">
          {!g ? (
            <div className="empty">{currentId ? "모임 불러오는 중…" : "모임을 선택해 주세요."}</div>
          ) : (
            <>
              <div className="btnrow">
                {pill(...(STATUS[g.status] || [g.status, "dark"]))}
                {pill(g.joinMode === "approval" ? "모임장 승인제" : "즉시 참여제", g.joinMode === "approval" ? "purple" : "blue")}
                {isLeader ? pill("👑 내가 모임장", "red") : null}
              </div>
              <h2>{g.title}</h2>
              <div className="metadata">
                {"🎪 "}
                {festival(g.festivalId)?.name || g.festivalId}
                {"   📍 "}
                {festival(g.festivalId)?.region || "미정"}
                {"   📅 "}
                {period(festival(g.festivalId))}
              </div>
              <div className="member-chips">
                {g.members.map((m) => (
                  <span key={m.userId}>
                    {m.role === "leader" ? "👑" : "👤"} {m.user.displayName}
                  </span>
                ))}
                <span>
                  정원 {g.memberCount} / {g.capacity}명
                </span>
              </div>
              <div className="post">{g.postBody}</div>

              <div className="note">
                <strong>모집 현황</strong> · 정원 {g.capacity}명 · 현재 {g.memberCount}명
                {isLeader ? ` · 승인 대기 ${pending.length}명` : ""} · {g.status === "open" ? "참여 신청 가능" : "모집 종료 (게시글 유지)"}
              </div>
              {notice && (
                <div className="note coral" role="status" style={{ marginTop: "10px" }}>
                  {notice}
                </div>
              )}
              <div style={{ height: "12px" }} />

              {/* 내 상태에 따라 버튼 하나만 */}
              <div className="btnrow">
                {isLeader || isMember ? (
                  <>
                    {isLeader ? null : pill("✅ 참여 확정", "green")}
                    {/* 플로우 다음 단계: 참여 확정 → 공동 일정 */}
                    <button type="button" className="btn" onClick={() => navigate(`/schedules?groupId=${encodeURIComponent(g.id)}`)}>
                      🗓️ 공동 일정 {isLeader ? "만들기" : "보기"} →
                    </button>
                  </>
                ) : myPending ? (
                  pill("⏳ 승인 대기 중", "purple")
                ) : g.status !== "open" ? (
                  pill("모집이 마감됐어요", "dark")
                ) : (
                  <button
                    type="button"
                    className="btn primary"
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
                )}
              </div>
              {me && !isLeader && !isMember && !myPending && g.status === "open" && g.joinMode === "approval" && (
                <div className="comment-form" style={{ marginTop: "8px" }}>
                  <input maxLength={300} placeholder="모임장에게 한마디 (선택) · 예) 오후 3시부터 참여 가능해요" aria-label="신청 메시지" value={joinMsg} onChange={(e) => setJoinMsg(e.target.value)} />
                </div>
              )}

              {isLeader && pending.length > 0 && (
                <>
                  <div className="divider" />
                  <h3 style={{ fontSize: "14px" }}>모임장 승인 대기 {pending.length}명</h3>
                  {pending.map((r) => (
                    <div className="request" key={r.id}>
                      <div>
                        <strong>👤 신청자 #{shortId(r.userId)}</strong>
                        <br />
                        <small>
                          {r.message ? `“${r.message}” · ` : ""}
                          {fmt(r.createdAt)}
                        </small>
                      </div>
                      <div className="btnrow">
                        <button type="button" className="btn small green" disabled={busy} onClick={() => act(() => approveJoin(g.id, r.id, g.version), "승인했어요. 참여가 확정됐어요! 이제 ‘공동 일정 만들기’로 참여자 조건에 맞는 일정을 만들 수 있어요.")}>
                          승인
                        </button>
                        <button type="button" className="btn small" disabled={busy} onClick={() => act(() => rejectJoin(g.id, r.id, g.version), "거절했어요. 신청자에게 안내돼요.")}>
                          거절
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}

              <div className="divider" />
              <div className="section-head" style={{ margin: "0 0 9px" }}>
                <h2>
                  {"공개 댓글 "}
                  <span className="muted">({g.comments.length})</span>
                </h2>
                {pill("참여 전에도 공개", "blue")}
              </div>
              {g.comments.length ? (
                g.comments.map((c) => (
                  <div className="comment" key={c.id}>
                    <span className="miniava">{(c.author.displayName || "?").slice(0, 1)}</span>
                    <div className="content">
                      <strong>{c.author.displayName}</strong>
                      <span className="tiny muted"> · {fmt(c.createdAt)}</span>
                      <p>{c.text}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="note">첫 공개 댓글을 남겨 보세요.</div>
              )}
              {me && (
                <form
                  className="comment-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (comment.trim()) act(() => addComment(g.id, comment.trim())).then(() => setComment(""));
                  }}
                >
                  <input maxLength={500} placeholder="공개 댓글로 인사하거나 참여 의사를 밝혀보세요" aria-label="공개 댓글" value={comment} onChange={(e) => setComment(e.target.value)} />
                  <button type="submit" className="btn small" disabled={busy || !comment.trim()}>
                    댓글 등록
                  </button>
                </form>
              )}
            </>
          )}
        </article>
      </div>
    </>
  );
}
