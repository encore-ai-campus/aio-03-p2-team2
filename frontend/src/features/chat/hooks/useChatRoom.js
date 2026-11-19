// WebSocket은 즉시 표시하고, DB 조회는 다른 인스턴스와 시스템 메시지를 보충한다.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { listMessages, openChatSocket, sendMessage } from "../api/chatApi.js";
import { chatError, mergeMsgs, newId } from "../lib/chatFormat.js";

export function useChatRoom(roomId) {
  const [messages, setMessages] = useState(null);
  const [pending, setPending] = useState([]); // 보내는 중·실패한 내 메시지
  const [loadError, setLoadError] = useState(null);
  const [olderCursor, setOlderCursor] = useState(null);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState(null);
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
    setOlderCursor(null);
    setOlderLoading(false);
    setOlderError(null);
    setLive("connecting");
    setText("");
    if (!roomId) return;
    const room = { alive: true, loadingOlder: false };
    activeRoom.current = room;
    let ws = null;
    let poll = null;
    let retry = null;
    let forwardCursor = "";
    let refreshing = false;

    const stop = () => {
      room.alive = false;
      clearInterval(poll);
      clearTimeout(retry);
      ws?.close();
    };
    const stopWhenDenied = (error) => {
      if (!room.alive) return;
      if (error?.status !== 403 && error?.status !== 404) return;
      stop();
      setLive("unavailable");
      setLoadError(error);
    };
    const refresh = async () => {
      if (!room.alive || refreshing) return;
      refreshing = true;
      try {
        // Re-read a recent page so an earlier message committed late can still appear.
        const latest = await listMessages(roomId);
        if (!room.alive || !latest.items.length) return;
        setMessages((prev) => mergeMsgs(prev, latest.items));
        const newestId = latest.items.at(-1).id;
        if (latest.nextCursor && !latest.items.some((item) => item.id === forwardCursor)) {
          let after = forwardCursor;
          while (room.alive) {
            const { items, nextCursor } = await listMessages(roomId, { after });
            if (!room.alive || !items.length) break;
            setMessages((prev) => mergeMsgs(prev, items));
            if (!nextCursor || items.some((item) => item.id === newestId)) break;
            after = nextCursor;
          }
        }
        forwardCursor = newestId;
      } catch (error) {
        stopWhenDenied(error);
      } finally {
        refreshing = false;
      }
    };
    const reconnect = () => {
      if (!room.alive) return;
      setLive("polling");
      clearTimeout(retry);
      retry = setTimeout(connect, 15000);
    };
    const connect = async () => {
      try {
        ws = await openChatSocket(roomId, {
          onOpen: () => {
            if (!room.alive) return;
            setLive("live");
            refresh();
          },
          onMessage: (m) => room.alive && setMessages((prev) => mergeMsgs(prev, [m])),
          onClose: (event) => {
            if (event?.reason === "CHAT_MEMBER_ONLY" || event?.reason === "GROUP_NOT_FOUND") {
              stopWhenDenied({ status: 403, code: event.reason });
              return;
            }
            reconnect();
          },
        });
        if (!room.alive) ws.close();
      } catch {
        reconnect();
      }
    };

    listMessages(roomId)
      .then(({ items, nextCursor }) => {
        if (!room.alive) return;
        forwardCursor = items.at(-1)?.id ?? "";
        setMessages(mergeMsgs([], items));
        setOlderCursor(nextCursor);
        poll = setInterval(refresh, 5000);
        connect();
      })
      .catch((e) => room.alive && setLoadError(e));

    return () => {
      activeRoom.current = null;
      stop();
    };
  }, [roomId, reload]);

  async function loadOlder() {
    const room = activeRoom.current;
    if (!room?.alive || room.loadingOlder || olderCursor == null) return;
    room.loadingOlder = true;
    setOlderLoading(true);
    setOlderError(null);
    try {
      const { items, nextCursor } = await listMessages(roomId, { before: olderCursor });
      if (!room.alive) return;
      setMessages((prev) => mergeMsgs(prev, items));
      setOlderCursor(nextCursor);
    } catch (error) {
      if (room.alive) setOlderError(error);
    } finally {
      room.loadingOlder = false;
      if (room.alive) setOlderLoading(false);
    }
  }

  // 전송 — 먼저 화면에 표시, 실패하면 「다시 보내기」
  const send = useCallback(
    async (body, cid = newId()) => {
      const room = activeRoom.current;
      if (!roomId || !room?.alive) return;
      setPending((p) => [
        ...p.filter((x) => x.clientMessageId !== cid),
        { clientMessageId: cid, text: body, status: "sending", createdAt: new Date().toISOString() },
      ]);
      try {
        const m = await sendMessage(roomId, body, cid);
        if (!room.alive) return;
        setMessages((prev) => mergeMsgs(prev, [m]));
        setPending((p) => p.filter((x) => x.clientMessageId !== cid));
      } catch (e) {
        if (!room.alive) return;
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

  return {
    messages, pending, loadError, live, text, setText, inputRef, send, onSubmit, discard, retryLoad,
    hasOlder: olderCursor != null, olderLoading, olderError, loadOlder,
  };
}
