// 메시지 목록 — 날짜가 바뀌면 구분선, 시스템 메시지, 내 메시지(보내는 중·전송 실패 → 다시 보내기·삭제)
import { Fragment } from "react";
import { WEEK, ymd } from "../lib/chatFormat.js";

export default function ChatMessages({ shown, me, onResend, onDiscard }) {
  if (!shown.length) return <div className="system-message">아직 대화가 없어요. 첫 메시지를 보내 보세요.</div>;

  let lastDay = "";
  return shown.map((m) => {
    const d = new Date(m.createdAt);
    const ok = !Number.isNaN(+d);
    const key = ok ? ymd(d) : "";
    const divider =
      key && key !== lastDay ? (
        <div className="date-divider">
          {d.getMonth() + 1}월 {d.getDate()}일 ({WEEK[d.getDay()]})
        </div>
      ) : null;
    if (key) lastDay = key;
    const tm = ok ? d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" }) : "";
    const own = me && m.sender?.id === me.id;
    const name = m.sender?.displayName || "참여자";
    return (
      <Fragment key={m.id}>
        {divider}
        {m.type === "system" ? (
          <div className="system-message">
            {m.text} <span style={{ opacity: ".75" }}>{tm}</span>
          </div>
        ) : (
          <div className={`chat-msg ${own ? "own" : ""} ${m.local ? "ct-pending" : ""}`}>
            <span className="ct-ava" aria-hidden="true">
              {name.slice(0, 1)}
            </span>
            <div className="ct-msg-body">
              <div className="who">
                {own ? "나" : name} · {m.status === "sending" ? "보내는 중…" : tm}
              </div>
              <div className="chat-bubble">{m.text}</div>
              {m.status === "failed" && (
                <div className="ct-fail" role="alert">
                  <span>전송 실패</span>
                  <button type="button" onClick={() => onResend(m.text, m.clientMessageId)}>
                    다시 보내기
                  </button>
                  <button type="button" className="ghost" onClick={() => onDiscard(m.clientMessageId)}>
                    삭제
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Fragment>
    );
  });
}
