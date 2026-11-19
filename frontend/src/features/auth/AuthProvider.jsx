// 로그인 상태를 앱 전체에 나눠 주는 곳. 어느 화면에서든 useAuth() 로 꺼내 쓴다.
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../../shared/lib/supabase.js";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // 로그인 정보 (안에 access_token = JWT)
  const [loading, setLoading] = useState(true); // 새로고침 직후 저장된 로그인 확인 중

  useEffect(() => {
    // 1) 새로고침해도 브라우저에 저장된 로그인을 다시 불러온다
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    // 2) 로그인·로그아웃·토큰 갱신이 일어날 때마다 자동으로 반영한다
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    // display_name 은 DB 트리거가 users.display_name 으로 넣어 준다 (1~20자)
    signUp: (email, password, displayName) =>
      supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: window.location.origin, // 인증 메일 링크를 누르면 우리 앱으로 돌아옴
        },
      }),
    signOut: () => supabase.auth.signOut(),
    // 온보딩을 한 번 거쳤다는 표시 (저장하든 "나중에"를 누르든) — Supabase 계정 정보(user_metadata)에 저장
    markOnboarded: () => supabase.auth.updateUser({ data: { onboarded: true } }),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
