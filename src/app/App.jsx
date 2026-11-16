import { Navigate, Route, Routes } from "react-router-dom";
import { DemoProvider, paths, useDemo } from "./DemoProvider.jsx";
import { AuthProvider } from "../features/auth/AuthProvider.jsx";
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
import TeamPage from "../shared/pages/TeamPage.jsx";
function HomeRedirect() {
  const { state } = useDemo();
  return <Navigate to={paths[state.page] || paths.discover} replace />;
}
export default function App() {
  return (
    <AuthProvider>
      <DemoProvider>
        <Routes>
          {/* 로그인 없이 볼 수 있는 화면 */}
          <Route path="login" element={<LoginPage />} />
          {/* 로그인해야 볼 수 있는 화면 */}
          <Route element={<RequireAuth />}>
            <Route path="onboarding" element={<OnboardingPage />} />
            <Route element={<AppLayout />}>
              <Route index element={<HomeRedirect />} />
              <Route path="festivals" element={<FestivalExplorePage />} />
              <Route path="matching" element={<MatchingPage />} />
              <Route path="groups" element={<CommunityPage />} />
              <Route path="chat" element={<ChatPage />} />
              <Route path="schedules" element={<SchedulePage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="team" element={<TeamPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/festivals" replace />} />
            </Route>
          </Route>
        </Routes>
      </DemoProvider>
    </AuthProvider>
  );
}
