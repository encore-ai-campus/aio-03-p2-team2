import { Navigate, Route, Routes } from "react-router-dom";
import { DemoProvider, paths, useDemo } from "./DemoProvider.jsx";
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
    <DemoProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="festivals" element={<FestivalExplorePage />} />
          <Route path="matching" element={<MatchingPage />} />
          <Route path="groups" element={<CommunityPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="schedules" element={<SchedulePage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="*" element={<Navigate to="/festivals" replace />} />
        </Route>
      </Routes>
    </DemoProvider>
  );
}
