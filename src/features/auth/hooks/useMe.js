// 현재 로그인한 앱 사용자 (GET /me) — 모임장 판단처럼 내 users.id가 필요할 때 사용
// JWT의 sub(Supabase 계정 ID)는 users.id와 다르므로 반드시 이 값을 쓴다.
import { useEffect, useState } from "react";
import { apiFetch } from "../../../shared/lib/apiClient.js";
import { useAuth } from "../AuthProvider.jsx";

export function useMe() {
  const { user } = useAuth();
  const accountId = user?.id;
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!accountId) {
      setResult(null);
      return;
    }
    let alive = true;
    apiFetch("/me")
      .then((me) => { if (alive) setResult({ accountId, me }); })
      .catch(() => { if (alive) setResult(null); });
    return () => {
      alive = false;
    };
  }, [accountId]);
  return result?.accountId === accountId ? result?.me ?? null : null;
}
