// 동행 커뮤니티 — 실제 API 버전 (GET /groups → 상세 GET /groups/{id})
// 참여 신청(POST join-requests) · 모임장 승인/거절(version 포함) · 공개 댓글
// 모임장 판단은 GET /me 의 users.id 와 group.leaderId 비교 (JWT sub와 다름)
// 목록 API가 실패하면 onFail()로 CommunityPage가 기존 데모 화면을 보여준다.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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

  const loadList = useCallback(
    () =>
      listGroups()
        .then(setGroups)
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
            .then((group) => {
              setDetail(group);
              // 신청 목록은 상세에 없어서 모임장일 때만 따로 조회
              if (me && group.leaderId === me.id) return listJoinRequests(group.id).then(setRequests);
              setRequests([]);
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

  return (
    <>
      <div className="section-head">
        <div>
          <h2>
            {"모임 목록 "}
            <span className="muted sm">{shown.length}개</span> {pill("🟢 실제 모임 데이터", "green")}
          </h2>
          <p>생성일 최신순 · 정원·참여 방식 확인</p>
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
                  className={`box pad room-card ${item.id === currentId ? "active" : ""}`}
                  style={{ textAlign: "left", width: "100%" }}
                  onClick={() => setParams({ groupId: item.id })}
                >
                  <div className="btnrow">
                    {pill(label, tone)}
                    {pill(item.joinMode === "approval" ? "승인제" : "즉시 참여", item.joinMode === "approval" ? "purple" : "blue")}
                    {me && item.leaderId === me.id ? pill("👑 내가 모임장", "red") : null}
                  </div>
                  <strong>{item.title}</strong>
                  <div className="tiny muted">
                    {f ? `${f.emoji} ${f.name}` : item.festivalId} · 👥 {item.memberCount}/{item.capacity}명
                    {item.pendingRequestCount ? ` · 신청 대기 ${item.pendingRequestCount}` : ""}
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
                {isLeader ? pill("👑 내가 모임장", "red") : isMember ? pill("✅ 참여 중", "green") : null}
              </div>
              <h2>{g.title}</h2>
              <p className="sm muted">
                {festival(g.festivalId) ? `${festival(g.festivalId).emoji} ${festival(g.festivalId).name}` : g.festivalId}
              </p>
              <p style={{ whiteSpace: "pre-line" }}>{g.postBody}</p>

              <div className="note">
                <strong>
                  👥 정원 {g.memberCount}/{g.capacity}명
                </strong>
                <div className="score-bar" style={{ marginTop: "6px" }}>
                  <div style={{ width: Math.min(100, (g.memberCount / g.capacity) * 100) + "%" }} />
                </div>
                <div className="tiny muted" style={{ marginTop: "6px" }}>
                  {g.members.map((m) => `${m.role === "leader" ? "👑 " : ""}${m.user.displayName}`).join(" · ")}
                </div>
              </div>

              {notice && (
                <div className="note coral" role="status">
                  {notice}
                </div>
              )}

              {/* 참여 신청 (모임장·멤버가 아닐 때) */}
              {me && !isLeader && !isMember && (
                <div className="note">
                  {myPending ? (
                    <strong>⏳ 참여 신청 완료 · 모임장 승인을 기다리는 중이에요</strong>
                  ) : g.status !== "open" ? (
                    <strong>모집이 마감된 모임이에요</strong>
                  ) : (
                    <>
                      <input
                        className="input"
                        maxLength={300}
                        placeholder="모임장에게 한마디 (선택) — 예) 사진 찍는 거 좋아해요!"
                        value={joinMsg}
                        onChange={(e) => setJoinMsg(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn primary"
                        style={{ marginTop: "8px" }}
                        disabled={busy}
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
              )}

              {/* 모임장: 신청 승인/거절 */}
              {isLeader && (
                <div className="note">
                  <strong>📮 참여 신청 {pending.length}건</strong>
                  {pending.length === 0 && <div className="tiny muted">대기 중인 신청이 없어요.</div>}
                  {pending.map((r) => (
                    <div key={r.id} style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
                      <span className="sm">
                        신청자 #{shortId(r.userId)}
                        {r.message ? ` · “${r.message}”` : ""}
                      </span>
                      <button type="button" className="btn small primary" disabled={busy} onClick={() => act(() => approveJoin(g.id, r.id, g.version), "승인했어요. 참여가 확정됐어요!")}>
                        승인
                      </button>
                      <button type="button" className="btn small" disabled={busy} onClick={() => act(() => rejectJoin(g.id, r.id, g.version), "거절했어요. 신청자에게 안내돼요.")}>
                        거절
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 공개 댓글 */}
              <div className="section-head" style={{ marginTop: "12px" }}>
                <h3>💬 공개 댓글 {g.comments.length}</h3>
              </div>
              {g.comments.map((c) => (
                <div className="comment" key={c.id}>
                  <div className="content">
                    <strong>{c.author.displayName}</strong>
                    <span className="tiny muted"> · {new Date(c.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    <p>{c.text}</p>
                  </div>
                </div>
              ))}
              {me && (
                <form
                  style={{ display: "flex", gap: "8px", marginTop: "8px" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (comment.trim()) act(() => addComment(g.id, comment.trim())).then(() => setComment(""));
                  }}
                >
                  <input className="input" style={{ flex: 1 }} maxLength={500} placeholder="공개 댓글로 인사해 보세요" value={comment} onChange={(e) => setComment(e.target.value)} />
                  <button type="submit" className="btn small" disabled={busy || !comment.trim()}>
                    등록
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
