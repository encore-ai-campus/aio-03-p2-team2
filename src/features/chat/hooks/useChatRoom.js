// 채팅방 하나 — 최근 메시지 조회 → WebSocket 실시간 수신 → 전송(POST, 먼저 화면에 표시)
// WebSocket이 끊기면 5초마다 다시 불러오고, 15초 뒤 재연결을 시도한다.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { listMessages, openChatSocket, sendMessage } from "../api/chatApi.js";
import { chatError, mergeMsgs, newId } from "../lib/chatFormat.js";

export function useChatRoom(roomId) {
  const [messages, setMessages] = useState(null);
  const [pending, setPending] = useState([]); // 보내는 중·실패한 내 메시지
  const [loadError, setLoadError] = useState(null);
  const [live, setLive] = useState("connecting");
  const [text, setText] = useState("");
  const [reload, setReload] = useState(0);
  const activeRoom = useRef(null);
  const inputRef = useRef(null);

  // 메시지 조회 + 실시간 연결
  useLayoutEffect(() => {
    setMessages(null);
    setPending([]);
    setLoadError(null);
    setLive("connecting");
    setText("");
    if (!roomId) return;
    let alive = true;
    activeRoom.current = () => alive;
    let ws = null;
    let poll = null;
    let retry = null;

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
      activeRoom.current = null;
      clearInterval(poll);
      clearTimeout(retry);
      if (ws) ws.close();
    };
  }, [roomId, reload]);

  // 전송 — 먼저 화면에 표시, 실패하면 「다시 보내기」
  const send = useCallback(
    async (body, cid = newId()) => {
      const isActive = activeRoom.current;
      if (!roomId || !isActive?.()) return;
      setPending((p) => [
        ...p.filter((x) => x.clientMessageId !== cid),
        { clientMessageId: cid, text: body, status: "sending", createdAt: new Date().toISOString() },
      ]);
      try {
        const m = await sendMessage(roomId, body, cid);
        if (!isActive()) return;
        setMessages((prev) => mergeMsgs(prev, [m]));
        setPending((p) => p.filter((x) => x.clientMessageId !== cid));
      } catch (e) {
        if (!isActive()) return;
        console.warn("[chat] 전송 실패", e);
        setPending((p) => p.map((x) => (x.clientMessageId === cid ? { ...x, status: "failed", error: chatError(e) } : x)));
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

  const discard = (cid) => setPending((p) => p.filter((x) => x.clientMessageId !== cid));
  const retryLoad = () => setReload((n) => n + 1);

  return { messages, pending, loadError, live, text, setText, inputRef, send, onSubmit, discard, retryLoad };
}
