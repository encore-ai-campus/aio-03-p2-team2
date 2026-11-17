// 로그인해야 들어갈 수 있는 화면들을 감싸는 문지기.
// 첫 로그인 판단: 서버 GET /me 의 onboardingCompleted 우선, 계정 정보(user_metadata.onboarded)도 함께 인정
//  - 둘 중 하나라도 "완료"면 통과 (다른 기기에서 완료했거나, 방금 온보딩을 마친 경우)
//  - 서버가 판단 못 하면(null·연결 실패) 계정 정보만으로 판단
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { apiFetch } from "../../../shared/lib/apiClient.js";
import { useAuth } from "../AuthProvider.jsx";

// optional=true: 로그인 없이도 볼 수 있는 화면(메인 축제 탐색)용.
//  - 비로그인 → 그대로 보여 줌 / 로그인했는데 온보딩 전 → 온보딩으로 (기존 규칙 유지)
export default function RequireAuth({ optional = false }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  const userId = session?.user?.id;
  const metaDone = !!session?.user?.user_metadata?.onboarded;
  const [server, setServer] = useState({ userId: null, completed: null }); // completed: true | false | null(모름)

  useEffect(() => {
    if (!userId || metaDone) return; // 계정 정보로 이미 완료면 서버 확인 불필요
    let alive = true;
    apiFetch("/me")
      .then((me) => alive && setServer({ userId, completed: me?.onboardingCompleted ?? null }))
      .catch(() => alive && setServer({ userId, completed: null }));
    return () => {
      alive = false;
    };
  }, [userId, metaDone]);

  if (loading) return <div className="auth-loading">로그인 상태를 확인하고 있어요…</div>;
  if (!session && optional) return <Outlet />;
  if (!session) {
    // 원래 가려던 주소를 기억해 두었다가 로그인 후 그곳으로 보낸다
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!metaDone && location.pathname !== "/onboarding") {
    if (server.userId !== userId) return <div className="auth-loading">프로필을 확인하고 있어요…</div>;
    // 첫 로그인: 서버에서 완료가 아니면 메인 화면보다 먼저 온보딩으로
    if (server.completed !== true) return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}
