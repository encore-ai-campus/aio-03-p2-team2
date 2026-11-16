// 로그인해야 들어갈 수 있는 화면들을 감싸는 문지기.
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../AuthProvider.jsx";

export default function RequireAuth() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="auth-loading">로그인 상태를 확인하고 있어요…</div>;
  if (!session) {
    // 원래 가려던 주소를 기억해 두었다가 로그인 후 그곳으로 보낸다
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  // 첫 로그인: 온보딩을 아직 안 거쳤으면 메인 화면보다 먼저 온보딩으로 보낸다
  if (!session.user.user_metadata?.onboarded && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}
