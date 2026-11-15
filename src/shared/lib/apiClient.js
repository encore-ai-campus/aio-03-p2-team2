// 백엔드(FastAPI) 호출 공통 함수 — 로그인 토큰(JWT)을 자동으로 붙인다.
// 사용 예: const festivals = await apiFetch("/festivals?year=2026");
import { supabase } from "./supabase.js";

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message || `API 오류 (${status})`);
    this.status = status; // 401, 403, 409 …
    this.code = error?.code; // AUTH_TOKEN_INVALID, GROUP_CAPACITY_EXCEEDED …
    this.details = error?.details;
  }
}

export async function apiFetch(path, { method = "GET", body, headers = {} } = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null; // 본문 없는 성공 (삭제·읽음 처리)
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    // 토큰 만료·위조 → 로그아웃시키면 로그인 화면으로 이동된다
    if (res.status === 401) await supabase.auth.signOut();
    throw new ApiError(res.status, json?.error);
  }
  return json?.data; // 백엔드 표준 응답 { data, meta } 중 data 만 돌려준다
}
