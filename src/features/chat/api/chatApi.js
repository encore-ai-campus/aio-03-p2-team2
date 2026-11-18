// 모임 채팅 API — 백엔드 기준: app/features/chat/router.py
// 참여 확정자만 사용 가능 (아니면 403 CHAT_MEMBER_ONLY)
import { apiFetch } from "../../../shared/lib/apiClient.js";
import { supabase } from "../../../shared/lib/supabase.js";

const enc = encodeURIComponent;

// GET /groups/{id}/messages — 메시지 한 페이지 (오래된 순)
export function listMessages(groupId, { before, after, limit = 50 } = {}) {
  const params = new URLSearchParams({ limit });
  if (before != null) params.set("before", before);
  if (after != null) params.set("after", after);
  return apiFetch(`/groups/${enc(groupId)}/messages?${params}`).then(({ items = [], nextCursor = null }) => ({ items, nextCursor }));
}

// POST /groups/{id}/messages — 같은 clientMessageId로 다시 보내면 중복 저장되지 않음
export const sendMessage = (groupId, text, clientMessageId) =>
  apiFetch(`/groups/${enc(groupId)}/messages`, { method: "POST", body: { text, clientMessageId } });

// WS /ws/groups/{id}/chat?accessToken=… — 새 메시지 실시간 수신 (서버 메모리 기준이라 백엔드 1대일 때만 정확)
export async function openChatSocket(groupId, { onOpen, onMessage, onClose }) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("로그인 토큰이 없어요.");
  const base = String(import.meta.env.VITE_API_BASE_URL || "").replace(/^http/, "ws");
  const ws = new WebSocket(`${base}/ws/groups/${enc(groupId)}/chat?accessToken=${enc(token)}`);
  ws.onmessage = (e) => {
    try {
      const p = JSON.parse(e.data);
      if (p.event === "chat.connected") onOpen?.();
      else if (p.event === "chat.message.created") onMessage?.(p.data);
    } catch {
      /* 형식이 다른 메시지는 무시 */
    }
  };
  ws.onclose = (event) => onClose?.(event);
  return ws;
}
