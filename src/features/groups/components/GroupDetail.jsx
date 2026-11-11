import { Fragment } from "react";
import { Button, Card } from "../../../shared/components/Primitives.jsx";
export function GroupDetail({ demo, g }) {
  const {
    state,
    btn,
    pill,
    fieldProps,
    dispatch,
    festival,
    person,
    period,
    groupClosed,
    formatDate,
    meetupScore,
  } = demo;
  if (!g)
    return (
      <>
        <div className="empty">모임이 없습니다.</div>
      </>
    );
  const f = festival(g.festivalId),
    leader = state.actor === g.leader,
    member = g.members.includes(state.actor),
    pending = g.pending.includes(state.actor),
    closed = groupClosed(g);
  let comments = g.comments.map((c, index) => (
    <Fragment key={index}>
      <div className="comment">
        <span className="miniava">{person(c.userId).emoji}</span>
        <div className="content">
          <strong>{person(c.userId).name}</strong>
          <span className="tiny muted">
            {" · "}
            {formatDate(c.at)}
          </span>
          <p>{c.text}</p>
        </div>
        <span
          className="match-percent"
          title="현재 사용자와 이 댓글 작성자의 축제 동행 적합도"
        >
          {meetupScore(c.userId, g.festivalId)}% 매칭
        </span>
      </div>
    </Fragment>
  ));
  return (
    <>
      <Card as="article" className="box pad room-detail">
        <div className="btnrow">
          {pill(closed ? "모집 마감" : "모집 중", closed ? "dark" : "green")}
          {pill(
            g.joinMode === "approval" ? "모임장 승인제" : "즉시 참여제",
            g.joinMode === "approval" ? "purple" : "blue",
          )}
          {leader ? pill("👑 내가 모임장", "red") : ""}
        </div>
        <h2>{g.title}</h2>
        <div className="metadata">
          {"🎪 "}
          {f.name}
          {" ("}
          {f.category}
          {") \xA0 📍 "}
          {f.region} {f.city}
          {" \xA0 📅 "}
          {period(f)}
        </div>
        <div className="member-chips">
          {g.members.map((id, index) => (
            <Fragment key={index}>
              <span>
                {id === g.leader ? "👑" : "👤"} {person(id).name}
              </span>
            </Fragment>
          ))}
          <span>
            {"정원 "}
            {g.members.length}
            {" / "}
            {g.max}명
          </span>
        </div>
        <div className="post">{g.post}</div>

        <div className="note">
          <strong>모집 현황</strong>
          {" · 정원 "}
          {g.max}
          {"명 · 현재 "}
          {g.members.length}
          {"명 · 승인 대기 "}
          {g.pending.length}
          {"명 · "}
          {closed ? "모집 종료 (게시글 유지)" : "참여 신청 가능"}
        </div>
        <div
          style={{
            height: "12px",
          }}
        />

        <div className="btnrow">
          {leader
            ? pill("모임장 · 직접 참여 승인", "red")
            : member
              ? btn("💬 채팅방 바로 입장", `openChat:${g.id}`, "btn primary")
              : pending
                ? pill("⏳ 승인 대기 중", "purple")
                : closed
                  ? pill("모집이 마감되었습니다", "dark")
                  : btn(
                      g.joinMode === "instant"
                        ? "⚡ 지금 참여하고 채팅 입장"
                        : "🙋 모임장에게 참여 신청",
                      `join:${g.id}`,
                      "btn primary",
                    )}
          {leader || member
            ? btn("공동 일정 보기", `openSchedule:${g.id}`, "btn")
            : ""}
        </div>

        {leader && g.pending.length ? (
          <>
            <div className="divider" />
            <h3
              style={{
                fontSize: "14px",
              }}
            >
              {"📩 모임장 승인 대기 "}
              {g.pending.length}명
            </h3>
            {g.pending.map((id, index) => (
              <Fragment key={index}>
                <div className="request">
                  <div>
                    <strong>
                      {person(id).emoji} {person(id).name}
                    </strong>
                    <br />
                    <small>
                      {"참여 가능 시작 "}
                      {person(id).start}
                      {" · 매칭 "}
                      {meetupScore(id, g.festivalId)}%
                    </small>
                  </div>
                  <div className="btnrow">
                    {btn("승인", `approve:${g.id}:${id}`, "btn small green")}
                    {btn("거절", `reject:${g.id}:${id}`, "btn small")}
                  </div>
                </div>
              </Fragment>
            ))}
          </>
        ) : (
          ""
        )}

        <div className="divider" />
        <div
          className="section-head"
          style={{
            margin: "0 0 9px",
          }}
        >
          <h2>
            {"💬 공개 댓글 "}
            <span className="muted">({g.comments.length})</span>
          </h2>
          {pill("참여 전에도 공개", "blue")}
        </div>
        <p className="sm muted">
          {"댓글은 누구나 작성할 수 있습니다. 각 작성자 오른쪽의 %는 "}
          <b>현재 로그인한 사람과의 축제 동행 매칭 점수</b>
          입니다.
        </p>
        {comments.length ? (
          comments
        ) : (
          <>
            <div className="note">첫 공개 댓글을 남겨 보세요.</div>
          </>
        )}
        <div className="comment-form">
          <input
            id="comment-input"
            maxLength="200"
            placeholder="공개 댓글로 인사하거나 참여 의사를 밝혀보세요"
            aria-label="공개 댓글"
            {...fieldProps("comment-input")}
          />
          <Button
            className="btn small"
            data-action="comment"
            onClick={(event) => {
              dispatch("comment");
            }}
          >
            댓글 등록
          </Button>
        </div>
        <p
          className="source-note"
          style={{
            marginTop: "12px",
          }}
        >
          연락처는 공개하지 않습니다. 모임 입장은 정원·승인 상태로 제어됩니다.
        </p>
      </Card>
    </>
  );
}
