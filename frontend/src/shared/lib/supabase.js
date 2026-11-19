// Supabase 연결 1곳 — 로그인·회원가입·세션(JWT)은 모두 이 객체로 처리한다.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // .env 가 없거나 비어 있으면 화면이 하얗게 되므로 원인을 콘솔에 먼저 알려 준다
  console.error("[supabase] .env 의 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 확인하세요.");
}

export const supabase = createClient(url, key);
