// 로그인 / 회원가입 화면 (Supabase Auth)
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthProvider.jsx";
import "../auth.css";

// Supabase 영문 오류 → 사용자용 한국어 문구
function toKoreanError(error) {
  const msg = error?.message || "";
  if (msg.includes("Invalid login credentials")) return "이메일 또는 비밀번호가 맞지 않아요.";
  if (msg.includes("Email not confirmed")) return "이메일 인증이 아직 안 됐어요. 메일함의 인증 링크를 눌러 주세요.";
  if (msg.includes("User already registered")) return "이미 가입된 이메일이에요. 로그인해 주세요.";
  if (msg.includes("Password should be")) return "비밀번호는 6자 이상이어야 해요.";
  if (msg.includes("rate limit")) return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
  return `문제가 생겼어요: ${msg}`;
}

export default function LoginPage() {
  const { session, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const goTo = location.state?.from || "/festivals";

  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // 이미 로그인돼 있으면 로그인 화면을 보여 줄 필요가 없다
  if (session) return <Navigate to={goTo} replace />;

  function switchMode(next) {
    setMode(next);
    setError("");
    setNotice("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);

    if (mode === "login") {
      const { error } = await signIn(email, password);
      setBusy(false);
      if (error) return setError(toKoreanError(error));
      navigate(goTo, { replace: true });
      return;
    }

    // 회원가입
    const name = displayName.trim();
    if (name.length < 1 || name.length > 20) {
      setBusy(false);
      return setError("이름은 1~20자로 입력해 주세요.");
    }
    const { data, error } = await signUp(email, password, name);
    setBusy(false);
    if (error) return setError(toKoreanError(error));

    // 이미 인증까지 끝난 이메일로 다시 가입하면 오류 없이 빈 identities 가 온다
    if (data.user && data.user.identities?.length === 0) {
      return setError("이미 가입된 이메일이에요. 로그인해 주세요.");
    }
    if (!data.session) {
      // 이메일 인증을 켜 둔 프로젝트: 메일 링크를 눌러야 로그인 가능
      setNotice(`${email} 로 인증 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.`);
      setMode("login");
      setPassword("");
      return;
    }
    navigate(goTo, { replace: true }); // 이메일 인증이 꺼져 있으면 바로 로그인됨
  }

  const isSignup = mode === "signup";

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/brand/fesroam_symbol.png" alt="" style={{ height: 36, width: "auto" }} />
          <div>
            <b>페스로움</b>
            <small>FESROAM · 축제 동행 매칭</small>
          </div>
        </div>

        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={!isSignup} className={!isSignup ? "active" : ""} onClick={() => switchMode("login")}>
            로그인
          </button>
          <button type="button" role="tab" aria-selected={isSignup} className={isSignup ? "active" : ""} onClick={() => switchMode("signup")}>
            회원가입
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {isSignup && (
            <label>
              이름
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={20} placeholder="모임에서 보일 이름 (1~20자)" required />
            </label>
          )}
          <label>
            이메일
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required />
          </label>
          <label>
            비밀번호
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isSignup ? "new-password" : "current-password"} minLength={6} placeholder="6자 이상" required />
          </label>

          {error && <p className="auth-msg error" role="alert">{error}</p>}
          {notice && <p className="auth-msg notice" role="status">{notice}</p>}

          <button type="submit" className="btn primary max" disabled={busy}>
            {busy ? "처리 중…" : isSignup ? "가입하기" : "로그인"}
          </button>
        </form>
      </div>
    </div>
  );
}
