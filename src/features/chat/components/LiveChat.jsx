// 모임 채팅방 — 실제 API 버전 (1단계: 내 모임방 목록 전체 폭 → 입장하면 목록은 왼쪽 좁은 칸, 채팅방이 오른쪽에서 밀려 들어옴)
// 흐름: 내 모임방 찾기(목록 → 상세 3개씩) → 최근 50개 조회 → WebSocket 실시간 수신 → 전송(POST, 먼저 화면에 표시)
// WebSocket이 끊기면 5초마다 다시 불러오고, 15초 뒤 재연결을 시도한다.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMe } from "../../auth/hooks/useMe.js";
import { useDemo } from "../../../app/DemoProvider.jsx";
import { useFestivals } from "../../festivals/hooks/useFestivals.js";
import { getGroup, listGroups } from "../../groups/api/groupsApi.js";
import { listMessages, openChatSocket, sendMessage } from "../api/chatApi.js";
import ChatHistory from "./ChatHistory.jsx";
import "./chat.css";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const ERROR_TEXT = {
  CHAT_MEMBER_ONLY: "모임 참여자만 채팅을 이용할 수 있어요.",
  GROUP_NOT_FOUND: "모임을 찾을 수 없어요.",
};
const msg = (e) => ERROR_TEXT[e?.code] || e?.message || "요청에 실패했어요.";
const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2)}`);
const dayLabel = (s) => {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(+d) ? s : `${d.getMonth() + 1}.${d.getDate()}(${WEEK[d.getDay()]})`;
};
const LIVE_TEXT = { live: "실시간 연결됨", polling: "실시간 끊김 · 5초마다 갱신", connecting: "연결 중…" };

// id 기준으로 합치고 시간순 정렬
const mergeMsgs = (prev, items) => {
  const map = new Map((prev || []).map((m) => [m.id, m]));
  items.forEach((m) => m && map.set(m.id, m));
  return [...map.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
};

export default function LiveChat({ onFail }) {
  const me = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [all, setAll] = useState(null); // 전체 모임 요약
  const [rooms, setRooms] = useState([]); // 내가 참여한 모임(상세)
  const [roomsDone, setRoomsDone] = useState(false);
  const [messages, setMessages] = useState(null);
  const [pending, setPending] = useState([]); // 보내는 중·실패한 내 메시지
  const [loadError, setLoadError] = useState(null);
  const [live, setLive] = useState("connecting");
  const [text, setText] = useState("");
  const [reload, setReload] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef(null);
  const { state: demoState } = useDemo();
  const { festivals } = useFestivals(demoState.festivals);
  const festivalName = (id) => festivals.find((f) => f.id === id)?.name || "";

  // 1) 내 모임방 찾기 — GET /groups 에는 참여자 정보가 없어 상세를 3개씩 조회 (DB 연결 풀 2 고려)
  useEffect(() => {
    if (!me) return;
    let alive = true;
    (async () => {
      try {
        const list = await listGroups();
        if (!alive) return;
        setAll(list);
        const found = [];
        for (let i = 0; i < list.length; i += 3) {
          const details = await Promise.all(list.slice(i, i + 3).map((g) => getGroup(g.id).catch(() => null)));
          if (!alive) return;
          details.forEach((d) => d && d.members.some((m) => m.userId === me.id) && found.push(d));
          setRooms([...found]);
        }
        setRoomsDone(true);
      } catch (e) {
        console.warn("[chat] 모임 목록 실패", e);
        if (alive) onFail?.();
      }
    })();
    return () => {
      alive = false;
    };
  }, [me, onFail]);

  const selId = params.get("groupId"); // 없으면 목록 화면
  const room = rooms.find((r) => r.id === selId);
  const roomId = room?.id;

  // 2) 메시지 조회 + 실시간 연결
  useEffect(() => {
    if (!roomId) return;
    let alive = true;
    let ws = null;
    let poll = null;
    let retry = null;
    setMessages(null);
    setPending([]);
    setLoadError(null);
    setLive("connecting");

    const refresh = () =>
      listMessages(roomId)
        .then((items) => alive && setMessages((prev) => mergeMsgs(prev, items)))
        .catch(() => {});
    const startPolling = () => {
      if (!poll) poll = setInterval(refresh, 5000);
      setLive("polling");
    };
    const connect = async () => {
      try {
        ws = await openChatSocket(roomId, {
          onOpen: () => {
            if (!alive) return;
            clearInterval(poll);
            poll = null;
            setLive("live");
            refresh(); // 끊긴 사이 메시지 보충
          },
          onMessage: (m) => alive && setMessages((prev) => mergeMsgs(prev, [m])),
          onClose: () => {
            if (!alive) return;
            startPolling();
            clearTimeout(retry);
            retry = setTimeout(connect, 15000);
          },
        });
        if (!alive) ws.close();
      } catch {
        if (alive) startPolling();
      }
    };

    listMessages(roomId)
      .then((items) => {
        if (!alive) return;
        setMessages(mergeMsgs([], items));
        connect();
      })
      .catch((e) => alive && setLoadError(e));

    return () => {
      alive = false;
      clearInterval(poll);
      clearTimeout(retry);
      if (ws) ws.close();
    };
  }, [roomId, reload]);

  // 3) 전송 — 먼저 화면에 표시, 실패하면 「다시 보내기」
  const send = useCallback(
    async (body, cid = newId()) => {
      if (!roomId) return;
      setPending((p) => [
        ...p.filter((x) => x.clientMessageId !== cid),
        { clientMessageId: cid, text: body, status: "sending", createdAt: new Date().toISOString() },
      ]);
      try {
        const m = await sendMessage(roomId, body, cid);
        setMessages((prev) => mergeMsgs(prev, [m]));
        setPending((p) => p.filter((x) => x.clientMessageId !== cid));
      } catch (e) {
        console.warn("[chat] 전송 실패", e);
        setPending((p) => p.map((x) => (x.clientMessageId === cid ? { ...x, status: "failed", error: msg(e) } : x)));
      }
    },
    [roomId],
  );

  function onSubmit(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    send(body);
    inputRef.current?.focus();
  }

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

  let lastDay = "";
  const renderMessage = (m) => {
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
                  <button type="button" onClick={() => send(m.text, m.clientMessageId)}>
                    다시 보내기
                  </button>
                  <button type="button" className="ghost" onClick={() => setPending((p) => p.filter((x) => x.clientMessageId !== m.clientMessageId))}>
                    삭제
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Fragment>
    );
  };

  const state = (icon, title, desc, action) => (
    <div className="ct-state">
      <i className={`ti ${icon}`} aria-hidden="true" />
      <b>{title}</b>
      {desc ? <span>{desc}</span> : null}
      {action}
    </div>
  );

  const other = selId && !room ? all?.find((g) => g.id === selId) : null;
  const open = Boolean(selId);

  // ===== 내 모임방 목록 (닫힘: 전체 폭 가로 카드 / 열림: 왼쪽 좁은 칸) =====
  const visible = showAll || open ? rooms : rooms.slice(0, 3);
  const list = (
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
            onClick={() => openRoom(r.id)}
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
      {roomsDone && !rooms.length
        ? open
          ? <div className="ct-side-empty">참여 중인 모임방이 없어요</div>
          : state(
              "ti-message-circle-off",
              "아직 참여한 모임방이 없어요",
              "동행 커뮤니티에서 모임 참여가 확정되면 채팅방이 열려요.",
              <button type="button" className="btn primary" onClick={() => toPost()}>
                동행 커뮤니티로 가기 →
              </button>,
            )
        : null}
    </section>
  );

  // ===== 채팅방 =====
  let body = null;
  if (!open) {
    body = null;
  } else if (!all || (!room && !roomsDone)) {
    body = state("ti-loader-2", "채팅방 여는 중…");
  } else if (!room) {
    body = state(
      "ti-lock",
      other ? "참여자 전용 채팅방이에요" : "모임을 찾을 수 없어요",
      other ? "모임장 승인으로 참여가 확정되면 이전 대화와 새 메시지를 볼 수 있어요." : "삭제되었거나 주소가 잘못된 모임이에요.",
      <button type="button" className="btn primary" onClick={() => toPost(other?.id)}>
        {other ? "모집글에서 참여 신청하기 →" : "동행 커뮤니티로 가기 →"}
      </button>,
    );
  } else if (loadError) {
    body = state(
      "ti-plug-connected-x",
      "메시지를 불러오지 못했어요",
      msg(loadError),
      <button type="button" className="btn primary" onClick={() => setReload((n) => n + 1)}>
        다시 불러오기
      </button>,
    );
  } else if (!messages) {
    body = state("ti-loader-2", "메시지 불러오는 중…");
  } else {
    body = (
      <>
        <ChatHistory className="chat-messages" roomId={room.id} messageCount={shown.length}>
          {shown.length ? shown.map(renderMessage) : <div className="system-message">아직 대화가 없어요. 첫 메시지를 보내 보세요.</div>}
        </ChatHistory>
        <form className="chat-compose" onSubmit={onSubmit}>
          <input
            ref={inputRef}
            maxLength={1000}
            placeholder="모임 참여자에게 메시지 보내기"
            autoComplete="off"
            aria-label="채팅 메시지"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn primary" type="submit" disabled={!text.trim()}>
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
        {list}
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
