import { useEffect, useRef, useState } from "react";
import { createPath, Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { paths } from "../../app/AppStateProvider.jsx";
import { useAuth } from "../../features/auth/AuthProvider.jsx";
import { Button } from "./Primitives.jsx";
import { useMe } from "../../features/auth/hooks/useMe.js";
import NotificationDropdown from "../../features/alerts/components/NotificationDropdown.jsx";
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

// 페이지를 옮기면 맨 위에서 시작 (이전 화면의 스크롤 위치가 남아 푸터부터 보이던 문제)
function useScrollTopOnNavigate(pathname) {
  useEffect(() => {
    if (typeof window !== "undefined" && !window.location.hash) window.scrollTo(0, 0);
  }, [pathname]);
}

export default function AppLayout() {
  const { user, signOut } = useAuth();
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate(); // 로그아웃 후 메인(홈)으로
  const isHome = location.pathname === "/";
  const hidden = useHideOnScroll(isHome);
  useScrollTopOnNavigate(location.pathname);
  const authFrom = location.pathname === "/login" ? { from: location.state?.from, reason: location.state?.reason } : { from: createPath(location) };
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
      <NotificationDropdown key={user.id} userId={user.id} hidden={hidden} />
    </>
  ) : (
    // 비로그인: 로그인 · 회원가입 → 로그인 후 지금 보던 화면으로 돌아옴 (로그인 화면에서는 원래 돌아갈 곳 유지)
    <>
      <Link to="/login" state={{ ...authFrom, mode: "login" }} className="gnb-txt">
        로그인
      </Link>
      <Link to="/login" state={{ ...authFrom, mode: "signup" }} className="gnb-login">
        회원가입
      </Link>
    </>
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
