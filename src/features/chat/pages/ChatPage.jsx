import ChatHistory from "../components/ChatHistory.jsx";
import { Fragment } from "react";
import { Button } from "../../../shared/components/Primitives.jsx";
import { useDemo } from "../../../app/DemoProvider.jsx";
export default function ChatPage() {
  const demo = useDemo();
  const {
    state,
    btn,
    fieldProps,
    dispatch,
    submitChat,
    group,
    person,
    formatDate,
    pageHead,
  } = demo;
  let rooms = state.groups
      .filter((g) => g.members.includes(state.actor))
      .sort((a, b) => new Date(b.created) - new Date(a.created)),
    g = group(state.selectedGroup) || rooms[0];
  const allowed = g && g.members.includes(state.actor);
  return (
    <>
      {pageHead(
        "PRIVATE GROUP CHAT",
        "💬 모임 채팅방",
        "모임 참여 승인이 완료되면 과거 대화까지 읽을 수 있습니다. 승인 전에는 채팅 내용에 접근할 수 없습니다.",
      )}

      <div className="chat-shell">
        <div className="chat-side">
          {(rooms.length ? rooms : state.groups.slice(0, 3)).map((r, index) => (
            <Fragment key={index}>
              <Button
                type="button"
                className={"" + "room-mini " + (r.id === g?.id ? "active" : "")}
                data-action={"" + "openChat:" + r.id}
                onClick={(event) => {
                  dispatch("" + "openChat:" + r.id);
                }}
              >
                <span
                  className={
                    "" +
                    "pill " +
                    (r.members.includes(state.actor) ? "green" : "dark")
                  }
                >
                  {r.members.includes(state.actor) ? "입장 가능" : "입장 제한"}
                </span>
                <div
                  style={{
                    marginTop: "7px",
                    fontWeight: "850",
                    fontSize: "12px",
                  }}
                >
                  {r.title}
                </div>
                <div
                  className="tiny muted"
                  style={{
                    marginTop: "5px",
                  }}
                >
                  {r.members.length}/{r.max}
                  {"명 · "}
                  {r.chat.length}개 메시지
                </div>
              </Button>
            </Fragment>
          ))}
        </div>

        <div className="box chat-area">
          <div className="chat-head">
            <div>
              <strong>{g?.title || "선택된 모임 없음"}</strong>
              <div className="tiny muted">
                {"참여자 "}
                {g?.members.length || 0}명 · 참여자만 입장·대화 가능
              </div>
            </div>
            {g ? btn("공동 일정", `openSchedule:${g.id}`, "btn small") : ""}
          </div>
          {!g ? (
            <>
              <div className="locked">
                <div className="big">💬</div>
                <h3>모임을 선택하세요</h3>
              </div>
            </>
          ) : !allowed ? (
            <>
              <div className="locked">
                <div className="big">🔒</div>
                <h3>참여자 전용 채팅방입니다</h3>
                <p>
                  모임이 승인되어야 이전 대화와 새 메시지를 볼 수 있습니다. 모임
                  신청 또는 승인 상태를 확인해 주세요.
                </p>
                <div>
                  {btn(
                    "공개 게시글로 돌아가기",
                    `openGroup:${g.id}`,
                    "btn primary",
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <ChatHistory
                className="chat-messages"
                id="chat-history"
                roomId={g.id}
                messageCount={g.chat.length}
              >
                {g.chat.map((m, index) => (
                  <Fragment key={index}>
                    {m.type === "system" ? (
                      <>
                        <div className="system-message">
                          {"🔔 "}
                          {m.text}{" "}
                          <span
                            style={{
                              opacity: ".6",
                            }}
                          >
                            {formatDate(m.at)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          className={
                            "" +
                            "chat-msg " +
                            (m.userId === state.actor ? "own" : "")
                          }
                        >
                          <span
                            className="miniava"
                            style={{
                              fontSize: "18px",
                            }}
                          >
                            {person(m.userId).emoji}
                          </span>
                          <div>
                            <div className="who">
                              {person(m.userId).name}
                              {" · "}
                              {formatDate(m.at)}
                            </div>
                            <div className="chat-bubble">{m.text}</div>
                          </div>
                        </div>
                      </>
                    )}
                  </Fragment>
                ))}
              </ChatHistory>
              <form
                className="chat-compose"
                id="chat-form"
                onSubmit={submitChat}
              >
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
      <div
        className="note"
        style={{
          marginTop: "14px",
        }}
      >
        {"🔒 실서비스에서는 세션·서버 권한(RLS)으로 "}
        <b>참여자 외 채팅 조회와 메시지 전송</b>을 차단해야 합니다. 이 파일은
        단일 브라우저 내 기능 시연용입니다.
      </div>
    </>
  );
}
