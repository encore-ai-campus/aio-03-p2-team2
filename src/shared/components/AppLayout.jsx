import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { paths } from "../../app/AppStateProvider.jsx";
import { useAuth } from "../../features/auth/AuthProvider.jsx";
import { Button } from "./Primitives.jsx";
import { useMe } from "../../features/auth/hooks/useMe.js";
import { listAlerts } from "../../features/alerts/api/alertsApi.js";
import TopNav from "./TopNav.jsx";
import SiteFooter from "./SiteFooter.jsx";
import "../styles/layout.css";

// 모바일 하단 탭바 메뉴 (560px 이하)
const TABS = [
  ["discover", "🎪", "탐색"],
  ["match", "💞", "매칭"],
  ["community", "👥", "커뮤니티"],
  ["room", "💬", "채팅"],
  ["schedule", "🗓️", "일정"],
];

// 홈에서만: 아래로 스크롤하면 헤더 숨김, 위로 올리면 보임
function useHideOnScroll(enabled) {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    if (!enabled) return setHidden(false);
    last.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setHidden(y > last.current && y > 600);
      last.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled]);
  return hidden;
}

export default function AppLayout() {
  const { user, signOut } = useAuth();
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate(); // 로그아웃 후 메인(홈)으로
  const isHome = location.pathname === "/";
  const hidden = useHideOnScroll(isHome);
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
    // user 객체는 로그인 상태 이벤트(창 포커스·토큰 갱신)마다 새로 만들어져 매번 다시 조회됐다 → 계정 id 기준으로만 다시 조회
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, user?.id]);
  const bell = liveBell ?? 0;

  const right = user ? (
    <>
      <span className="gnb-user" title={user?.email}>
        {me?.displayName || user?.user_metadata?.display_name || user?.email}
      </span>
      <NavLink to="/profile" className="gnb-txt">
        내 프로필
      </NavLink>
      <Button className="gnb-txt" onClick={() => signOut().then(() => navigate("/"))}>
        로그아웃
      </Button>
      <Button className="gnb-bell" title="AI 알림" aria-label="AI 알림" onClick={() => navigate(paths.alerts)}>
        <i className="ti ti-bell" aria-hidden="true" />
        <span className="gnb-badge" hidden={!bell}>
          {bell}
        </span>
      </Button>
    </>
  ) : (
    // 비로그인: 로그인 버튼 → 로그인 후 지금 보던 화면으로 돌아옴
    <Link to="/login" state={{ from: location.pathname }} className="gnb-login">
      로그인
    </Link>
  );

  return (
    <div className="site">
      <TopNav hidden={hidden} right={right} />
      <main className={isHome ? "main main-home" : "main"}>
        <Outlet />
      </main>
      <SiteFooter />
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
