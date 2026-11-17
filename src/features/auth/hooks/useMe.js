// 현재 로그인한 앱 사용자 (GET /me) — 모임장 판단처럼 내 users.id가 필요할 때 사용
// JWT의 sub(Supabase 계정 ID)는 users.id와 다르므로 반드시 이 값을 쓴다.
import { useEffect, useState } from "react";
import { apiFetch } from "../../../shared/lib/apiClient.js";
import { useAuth } from "../AuthProvider.jsx";

const cache = new Map(); // Supabase 계정 ID → GET /me 요청 (같은 계정이면 한 번만 호출)

export function useMe() {
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  useEffect(() => {
    if (!user) return setMe(null);
    if (!cache.has(user.id)) cache.set(user.id, apiFetch("/me").catch((e) => (cache.delete(user.id), Promise.reject(e))));
    let alive = true;
    cache.get(user.id).then((data) => alive && setMe(data)).catch(() => alive && setMe(null));
    return () => {
      alive = false;
    };
  }, [user]);
  return me; // { id: "usr_…", displayName, profile … } | null
}
