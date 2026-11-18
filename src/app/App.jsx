import { Navigate, Route, Routes } from "react-router-dom";
import { AppStateProvider, paths, useAppState } from "./AppStateProvider.jsx";
import { AuthProvider, useAuth } from "../features/auth/AuthProvider.jsx";
import RequireAuth from "../features/auth/components/RequireAuth.jsx";
import LoginPage from "../features/auth/pages/LoginPage.jsx";
import OnboardingPage from "../features/auth/pages/OnboardingPage.jsx";
import ProfilePage from "../features/auth/pages/ProfilePage.jsx";
import AppLayout from "../shared/components/AppLayout.jsx";
import FestivalExplorePage from "../features/festivals/pages/FestivalExplorePage.jsx";
import MatchingPage from "../features/matching/pages/MatchingPage.jsx";
import CommunityPage from "../features/groups/pages/CommunityPage.jsx";
import ChatPage from "../features/chat/pages/ChatPage.jsx";
import SchedulePage from "../features/schedules/pages/SchedulePage.jsx";
import AlertsPage from "../features/alerts/pages/AlertsPage.jsx";
function HomeRedirect() {
  const { state } = useAppState();
  const { session } = useAuth();
  return <Navigate to={session ? paths[state.page] || paths.discover : paths.discover} replace />;
}
export default function App() {
  return (
    <AuthProvider>
      <AppStateProvider>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="onboarding" element={<OnboardingPage />} />
          </Route>
          <Route element={<AppLayout />}>
            {/* 메인: 로그인 없이 볼 수 있는 화면 (로그인했는데 온보딩 전이면 온보딩으로) */}
            <Route element={<RequireAuth optional />}>
              <Route index element={<HomeRedirect />} />
              <Route path="festivals" element={<FestivalExplorePage />} />
            </Route>
            {/* 로그인해야 볼 수 있는 화면 → 비로그인 시 로그인 화면으로, 로그인 후 원래 화면으로 */}
            <Route element={<RequireAuth />}>
              <Route path="matching" element={<MatchingPage />} />
              <Route path="groups" element={<CommunityPage />} />
              <Route path="chat" element={<ChatPage />} />
              <Route path="schedules" element={<SchedulePage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="profile" element={<ProfilePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/festivals" replace />} />
          </Route>
        </Routes>
      </AppStateProvider>
    </AuthProvider>
  );
}
