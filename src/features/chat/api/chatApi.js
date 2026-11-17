// 모임 채팅 API — 백엔드 기준: app/features/chat/router.py
// 참여 확정자만 사용 가능 (아니면 403 CHAT_MEMBER_ONLY)
import { apiFetch } from "../../../shared/lib/apiClient.js";
import { supabase } from "../../../shared/lib/supabase.js";

const enc = encodeURIComponent;

// GET /groups/{id}/messages — 최근 메시지 (오래된 순)
// 백엔드 커서(before/after)는 id 크기 비교라 순서 보장이 안 돼서 쓰지 않고 최근 N개만 받는다
export const listMessages = (groupId, limit = 50) =>
  apiFetch(`/groups/${enc(groupId)}/messages?limit=${limit}`).then((d) => d.items || []);

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
  ws.onclose = () => onClose?.();
  return ws;
}
