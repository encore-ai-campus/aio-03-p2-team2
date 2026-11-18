// 모임 채팅방 — 실제 API 버전 (1단계: 내 모임방 목록 전체 폭 → 입장하면 목록은 왼쪽 좁은 칸, 채팅방이 오른쪽에서 밀려 들어옴)
// 흐름: 내 모임방 찾기(hooks/useMyChatRooms) → 메시지 조회·실시간 연결·전송(hooks/useChatRoom)
// 화면 조각: ChatRoomList(방 목록) · ChatMessages(메시지) · ChatState(상태 안내)
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { useFestivals } from "../../festivals/hooks/useFestivals.js";
import { useChatRoom } from "../hooks/useChatRoom.js";
import { useMyChatRooms } from "../hooks/useMyChatRooms.js";
import { LIVE_TEXT, chatError, dayLabel } from "../lib/chatFormat.js";
import ChatHistory from "./ChatHistory.jsx";
import ChatMessages from "./ChatMessages.jsx";
import ChatRoomList from "./ChatRoomList.jsx";
import ChatState from "./ChatState.jsx";
import "./chat.css";

export default function LiveChat({ onFail }) {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { festivals } = useFestivals();
  const { all, rooms, roomsDone } = useMyChatRooms(me, onFail);
  const festivalName = (id) => festivals.find((f) => f.id === id)?.name || "";

  const selId = params.get("groupId"); // 없으면 목록 화면
  const room = rooms.find((r) => r.id === selId);
  const chat = useChatRoom(room?.id);
  const { messages, pending, loadError, live } = chat;

  const openRoom = (id) => setParams({ groupId: id });
  const backToList = () => setParams({});
  const toSchedule = (id) => navigate(`/schedules?groupId=${encodeURIComponent(id)}`);
  const toPost = (id) => navigate(id ? `/groups?groupId=${encodeURIComponent(id)}` : "/groups");

  // 서버에 저장된 메시지 + 아직 서버에 없는 내 메시지
  const savedIds = new Set((messages || []).map((m) => m.clientMessageId).filter(Boolean));
  const shown = [
    ...(messages || []),
    ...pending.filter((p) => !savedIds.has(p.clientMessageId)).map((p) => ({ ...p, id: `local-${p.clientMessageId}`, local: true, sender: { id: me?.id }, type: "user" })),
  ];

  const other = selId && !room ? all?.find((g) => g.id === selId) : null;
  const open = Boolean(selId);

  // ===== 채팅방 =====
  let body = null;
  if (!open) {
    body = null;
  } else if (!all || (!room && !roomsDone)) {
    body = <ChatState icon="ti-loader-2" title="채팅방 여는 중…" />;
  } else if (!room) {
    body = (
      <ChatState
        icon="ti-lock"
        title={other ? "참여자 전용 채팅방이에요" : "모임을 찾을 수 없어요"}
        desc={other ? "모임장 승인으로 참여가 확정되면 이전 대화와 새 메시지를 볼 수 있어요." : "삭제되었거나 주소가 잘못된 모임이에요."}
        action={
          <button type="button" className="btn primary" onClick={() => toPost(other?.id)}>
            {other ? "모집글에서 참여 신청하기 →" : "동행 커뮤니티로 가기 →"}
          </button>
        }
      />
    );
  } else if (loadError) {
    body = (
      <ChatState
        icon="ti-plug-connected-x"
        title="메시지를 불러오지 못했어요"
        desc={chatError(loadError)}
        action={
          <button type="button" className="btn primary" onClick={chat.retryLoad}>
            다시 불러오기
          </button>
        }
      />
    );
  } else if (!messages) {
    body = <ChatState icon="ti-loader-2" title="메시지 불러오는 중…" />;
  } else {
    body = (
      <>
        <ChatHistory className="chat-messages" roomId={room.id} messageCount={shown.length}>
          <ChatMessages shown={shown} me={me} onResend={chat.send} onDiscard={chat.discard} />
        </ChatHistory>
        <form className="chat-compose" onSubmit={chat.onSubmit}>
          <input
            ref={chat.inputRef}
            maxLength={1000}
            placeholder="모임 참여자에게 메시지 보내기"
            autoComplete="off"
            aria-label="채팅 메시지"
            value={chat.text}
            onChange={(e) => chat.setText(e.target.value)}
          />
          <button className="btn primary" type="submit" disabled={!chat.text.trim()}>
            전송
          </button>
        </form>
      </>
    );
  }

  const headGroup = room || other;
  const fname = headGroup ? festivalName(headGroup.festivalId) : "";

  return (
    <>
      <div className="mp-head">
        <div>
          <h1>모임 채팅방</h1>
          <p>참여가 확정된 사람만 대화할 수 있어요. 승인되면 이전 대화도 볼 수 있어요</p>
        </div>
      </div>

      <div className={`ct-wrap ${open ? "is-open" : ""}`}>
        <ChatRoomList me={me} all={all} rooms={rooms} roomsDone={roomsDone} selId={selId} open={open} festivalName={festivalName} onOpenRoom={openRoom} onToPost={toPost} />
        {open ? (
          /* key로 방을 바꿀 때마다 오른쪽에서 밀려 들어오는 모션 */
          <div key={selId} className="box chat-area ct-room ct-enter">
            <div className="chat-head">
              <div className="ct-head-info">
                <strong>{headGroup?.title || "모임 채팅방"}</strong>
                {room ? (
                  <div className="ct-head-sub">
                    {fname ? <span>{fname}</span> : null}
                    {room.date ? (
                      <span>
                        {dayLabel(room.date)}
                        {room.startTime ? ` · ${room.startTime.slice(0, 5)} 합류` : ""}
                      </span>
                    ) : null}
                    <span>참여자 {room.memberCount}명</span>
                    <span className={`ct-live ${live}`}>{LIVE_TEXT[live]}</span>
                  </div>
                ) : null}
              </div>
              <div className="ct-head-actions">
                {room ? (
                  <>
                    <button type="button" className="btn small" onClick={() => toPost(room.id)}>
                      모집글
                    </button>
                    <button type="button" className="btn small" onClick={() => toSchedule(room.id)}>
                      공동 일정
                    </button>
                  </>
                ) : null}
                <button type="button" className="ct-close" aria-label="채팅방 닫기" title="채팅방 닫기" onClick={backToList}>
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              </div>
            </div>
            {body}
          </div>
        ) : null}
      </div>
    </>
  );
}
