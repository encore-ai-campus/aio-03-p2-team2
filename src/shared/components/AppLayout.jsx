import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAppState, paths } from "../../app/AppStateProvider.jsx";
import { useAuth } from "../../features/auth/AuthProvider.jsx";
import { Button } from "./Primitives.jsx";
import { useMe } from "../../features/auth/hooks/useMe.js";
import { listAlerts } from "../../features/alerts/api/alertsApi.js";

// 사이드바 메뉴 라인 아이콘 (메뉴 데이터 NAV는 그대로, 화면에서만 아이콘 교체)
const NAV_ICON = {
  discover: "ti-compass",
  match: "ti-users",
  community: "ti-message-circle",
  room: "ti-messages",
  schedule: "ti-calendar-event",
  alerts: "ti-bell",
};

// v4.3 · 모바일 하단 탭바 메뉴
const TABS = [
  ["discover", "🎪", "탐색"],
  ["match", "💞", "매칭"],
  ["community", "👥", "커뮤니티"],
  ["room", "💬", "채팅"],
  ["schedule", "🗓️", "일정"],
];

export default function AppLayout() {
  const { state, NAV, dispatch } = useAppState();
  const { user, signOut } = useAuth();
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate(); // 로그아웃 후 메인(축제 탐색)으로
  // 아직 답하지 않은 실제 알림 수를 표시한다.
  const [liveBell, setLiveBell] = useState(null);
  useEffect(() => {
    // 비로그인(메인 둘러보기)일 때는 내 알림을 조회하지 않는다
    if (!user) return setLiveBell(null);
    let alive = true;
    listAlerts()
      .then((items) => alive && setLiveBell(items.filter((a) => !a.choice).length))
      .catch(() => alive && setLiveBell(null));
    return () => {
      alive = false;
    };
  }, [location.pathname, user]);
  const bell = liveBell ?? 0;
  const pageName = NAV.find((row) => row[0] === state.page)?.[2] || "축제 탐색";

  return (
    <div className="app">
      <aside className="sidebar">
        {/* 로고 클릭 → 홈 (홈 화면 추가 전까지는 축제 탐색) */}
        <Link to="/" className="brand" aria-label="페스타메이트 홈">
          <img className="brand-logo" src="/brand/festamate_logo_horizontal.png" alt="페스타메이트" />
        </Link>
        <div>
          <div className="side-caption">FESTIVAL JOURNEY</div>
          <nav className="nav">
            {NAV.map(([id, emoji, label]) => (
              [id === "schedule" && <hr key="divider" className="nav-divider" />,
              <NavLink
                key={id}
                to={paths[id]}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                <span className="ico">{NAV_ICON[id] ? <i className={`ti ${NAV_ICON[id]}`} aria-hidden="true" /> : emoji}</span>
                {label}
              </NavLink>,
              ]
            ))}
          </nav>
        </div>
        <div className="sidefoot">
          <b>처음 오셨나요?</b>
          <p>축제 고르기 → AI 동행 매칭 → 모임 참여·채팅 순서로 이용해 보세요.</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>홈</Link>
            <span className="sep">/</span>
            <b>{pageName}</b>
          </div>
          <div className="top-right">
            {user ? (
              <>
                <span className="auth-user" title={user?.email}>
                  {me?.displayName || user?.user_metadata?.display_name || user?.email}
                </span>
                <NavLink to="/profile" className="btn small">
                  내 프로필
                </NavLink>
                <Button className="btn small" onClick={() => signOut().then(() => navigate("/festivals"))}>
                  로그아웃
                </Button>
                <Button
                  className="toplink bell"
                  title="AI 알림"
                  aria-label="AI 알림"
                  onClick={() => dispatch("nav:alerts")}
                >
                  <i className="ti ti-bell" aria-hidden="true" />
                  <span className="bell-badge" hidden={!bell}>
                    {bell}
                  </span>
                </Button>
              </>
            ) : (
              // 비로그인: 로그인 버튼 → 로그인 후 지금 보던 화면으로 돌아옴
              <Link to="/login" state={{ from: location.pathname }} className="btn small primary">
                로그인
              </Link>
            )}
          </div>
        </header>
        <main className="main">
          <Outlet />
        </main>
        <footer className="footer">
          FESTA MATE · 2026 Festival Discovery & AI Matching
        </footer>
      </div>
      <nav className="tabbar" aria-label="주요 메뉴">
        {TABS.map(([id, emoji, label]) => (
          <NavLink key={id} to={paths[id]} className={({ isActive }) => (isActive ? "active" : "")}>
            <span>{emoji}</span>
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
