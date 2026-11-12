import ChatHistory from "../components/ChatHistory.jsx";
import { Fragment } from "react";
import { Button } from "../../../shared/components/Primitives.jsx";
import { useDemo } from "../../../app/DemoProvider.jsx";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const ymd = (d) =>
  [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");

export default function ChatPage() {
  const demo = useDemo();
  const { state, btn, pill, fieldProps, dispatch, submitChat, group, person, pageHead } = demo;
  const rooms = state.groups
    .filter((g) => g.members.includes(state.actor))
    .sort((a, b) => new Date(b.created) - new Date(a.created));
  const g = group(state.selectedGroup) || rooms[0];
  const allowed = g && g.members.includes(state.actor);
  const others = state.groups.filter((x) => !x.members.includes(state.actor)).slice(0, 3);

  const mini = (r, lock) => (
    <Button
      key={r.id}
      className={`room-mini ${r.id === g?.id ? "active" : ""} ${lock ? "locked-mini" : ""}`}
      onClick={() => dispatch(`openChat:${r.id}`)}
    >
      {pill(lock ? "🔒 입장 제한" : "입장 가능", lock ? "dark" : "green")}
      <div style={{ marginTop: "7px", fontWeight: "850", fontSize: "12px" }}>{r.title}</div>
      <div className="tiny muted" style={{ marginTop: "5px" }}>
        {r.members.length}/{r.max}명{lock ? "" : ` · 메시지 ${r.chat.length}개`}
      </div>
    </Button>
  );

  // v4.3 · 날짜 구분선 + 시간 표시
  let lastDay = "";
  const messages = allowed
    ? g.chat.map((m, index) => {
        const d = new Date(m.at);
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
        return (
          <Fragment key={index}>
            {divider}
            {m.type === "system" ? (
              <div className="system-message">
                {/^\p{Extended_Pictographic}/u.test(m.text) ? "" : "🔔 "}
                {m.text} <span style={{ opacity: ".75" }}>{tm}</span>
              </div>
            ) : (
              <div className={`chat-msg ${m.userId === state.actor ? "own" : ""}`}>
                <span className="miniava" style={{ fontSize: "18px" }}>
                  {person(m.userId).emoji}
                </span>
                <div>
                  <div className="who">
                    {person(m.userId).name} · {tm}
                  </div>
                  <div className="chat-bubble">{m.text}</div>
                </div>
              </div>
            )}
          </Fragment>
        );
      })
    : null;

  return (
    <>
      {pageHead(
        "PRIVATE GROUP CHAT",
        "💬 모임 채팅방",
        "모임 참여 승인이 완료되면 과거 대화까지 읽을 수 있어요. 승인 전에는 채팅 내용에 접근할 수 없어요.",
      )}

      <div className="chat-shell">
        <div className="chat-side">
          {rooms.length ? (
            <>
              <div className="side-cap">내 모임방 {rooms.length}</div>
              {rooms.map((r) => mini(r, false))}
            </>
          ) : (
            <div className="side-cap">참여 중인 모임방이 없어요</div>
          )}
          {others.length > 0 && (
            <>
              <div className="side-cap lock">참여 전 모임 · 승인 후 입장</div>
              {others.map((r) => mini(r, true))}
            </>
          )}
        </div>

        <div className="box chat-area">
          <div className="chat-head">
            <div>
              <strong>{g?.title || "선택된 모임 없음"}</strong>
              <div className="tiny muted">참여자 {g?.members.length || 0}명 · 참여자만 입장·대화 가능</div>
            </div>
            {g ? btn("공동 일정", `openSchedule:${g.id}`, "btn small") : ""}
          </div>
          {!g ? (
            <div className="locked">
              <div className="big">💬</div>
              <h3>모임을 선택하세요</h3>
            </div>
          ) : !allowed ? (
            <div className="locked">
              <div className="big">🔒</div>
              <h3>참여자 전용 채팅방이에요</h3>
              <p>
                모임이 승인되어야 이전 대화와 새 메시지를 볼 수 있어요. 모임 신청 또는 승인 상태를 확인해
                주세요.
              </p>
              <div>{btn("공개 게시글로 돌아가기", `openGroup:${g.id}`, "btn primary")}</div>
            </div>
          ) : (
            <>
              <ChatHistory className="chat-messages" id="chat-history" roomId={g.id} messageCount={g.chat.length}>
                {messages}
              </ChatHistory>
              <form className="chat-compose" id="chat-form" onSubmit={submitChat}>
                <input
                  id="chat-input"
                  maxLength="600"
                  placeholder="모임 참여자에게 메시지 보내기"
                  autoComplete="off"
                  aria-label="채팅 메시지"
                  {...fieldProps("chat-input")}
                />
                <Button className="btn primary" type="submit">
                  전송
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  );
}
