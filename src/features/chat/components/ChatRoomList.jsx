// 내 모임방 목록 (닫힘: 전체 폭 가로 카드 / 열림: 왼쪽 좁은 칸)
import { useState } from "react";
import { dayLabel } from "../lib/chatFormat.js";
import ChatState from "./ChatState.jsx";

export default function ChatRoomList({ me, all, rooms, roomsDone, selId, open, festivalName, onOpenRoom, onToPost }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll || open ? rooms : rooms.slice(0, 3);
  return (
    <section className="ct-list" aria-label="내 모임방">
      <div className="ct-list-cap">
        내 모임방 <b>{rooms.length}</b>
        {!roomsDone ? <span> · 찾는 중…</span> : null}
      </div>
      {visible.map((r) => {
        const leader = me && r.leaderId === me.id;
        const fname = festivalName(r.festivalId);
        const active = r.id === selId;
        return (
          <button
            key={r.id}
            type="button"
            className={`ct-row ${active ? "active" : ""}`}
            aria-current={active ? "true" : undefined}
            onClick={() => onOpenRoom(r.id)}
          >
            <span className="ct-row-ico" aria-hidden="true">
              <i className="ti ti-messages" />
            </span>
            <span className="ct-row-main">
              <span className="ct-row-title">{r.title}</span>
              <span className="ct-row-meta">
                {fname ? (
                  <span>
                    <i className="ti ti-confetti" aria-hidden="true" /> {fname}
                  </span>
                ) : null}
                {r.date ? (
                  <span>
                    <i className="ti ti-calendar" aria-hidden="true" /> {dayLabel(r.date)}
                    {r.startTime ? ` · ${r.startTime.slice(0, 5)} 합류` : ""}
                  </span>
                ) : null}
              </span>
            </span>
            <span className="ct-row-side">
              {leader ? <span className="ct-leader">내가 모임장</span> : null}
              <span className="ct-count">
                <i className="ti ti-users" aria-hidden="true" /> {r.memberCount}/{r.capacity}명
              </span>
              <span className="ct-go">
                입장 <i className="ti ti-chevron-right" aria-hidden="true" />
              </span>
            </span>
          </button>
        );
      })}
      {!open && rooms.length > 3 ? (
        <button type="button" className="btn ct-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "접기" : `더 보기 (${rooms.length - 3})`}
        </button>
      ) : null}
      {!all || (!roomsDone && !rooms.length) ? <div className="ct-row-skel" aria-hidden="true" /> : null}
      {roomsDone && !rooms.length ? (
        open ? (
          <div className="ct-side-empty">참여 중인 모임방이 없어요</div>
        ) : (
          <ChatState
            icon="ti-message-circle-off"
            title="아직 참여한 모임방이 없어요"
            desc="동행 커뮤니티에서 모임 참여가 확정되면 채팅방이 열려요."
            action={
              <button type="button" className="btn primary" onClick={() => onToPost()}>
                동행 커뮤니티로 가기 →
              </button>
            }
          />
        )
      ) : null}
    </section>
  );
}
