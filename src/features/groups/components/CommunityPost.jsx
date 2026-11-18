// 2단계 상세 왼쪽: 모집글 본문 + 공개 댓글
import { addComment } from "../api/groupsApi.js";
import { fmt, when, where } from "../lib/communityFormat.js";
import { JoinBadge, MineBadge, StatusBadge } from "./CommunityBadges.jsx";

export default function CommunityPost({ g, f, me, isLeader, busy, comment, setComment, act }) {
  return (
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
  );
}
