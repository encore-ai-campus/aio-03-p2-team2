// 온보딩 — 토스처럼 한 화면에 질문 하나씩, '나를 소개하는 정보' 3단계만 받고 PATCH /me/profile 로 저장
// 예산·인원·시작 시각은 매칭할 때마다 바뀌는 조건이라 AI 동행 매칭(챗봇)에서 묻는다 (matching_runs.conditions)
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../../shared/lib/apiClient.js";
import { useAuth } from "../AuthProvider.jsx";
import { EMPTY_FORM, INTERESTS, MBTIS, STYLES, toProfileBody, toggleInList } from "../lib/profileOptions.js";
import "../auth.css";

const STEPS = ["interests", "style", "mbti"];

export default function OnboardingPage() {
  const { user, markOnboarded } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const name = user?.user_metadata?.display_name || "";
  const isLast = step === STEPS.length - 1;

  async function finish() {
    setError("");
    setBusy(true);
    try {
      await apiFetch("/me/profile", { method: "PATCH", body: toProfileBody(form) });
      await markOnboarded();
      navigate("/festivals", { replace: true });
    } catch (err) {
      if (err.status) setError(`저장하지 못했어요 (${err.status} ${err.code || ""})`);
      else setError("서버에 연결할 수 없어요. 백엔드 서버가 실행 중인지 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function skipAll() {
    await markOnboarded(); // 건너뛰어도 다음 로그인 때 다시 묻지 않음 ("내 프로필"에서 입력 가능)
    navigate("/festivals", { replace: true });
  }

  const next = () => (isLast ? finish() : setStep((s) => s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="auth-page">
      <div className="auth-card wide onb">
        {/* 위: 진행 단계 표시 */}
        <div className="onb-top">
          <span className="onb-count">{step + 1} / {STEPS.length}</span>
          <div className="onb-progress" aria-label={`${STEPS.length}단계 중 ${step + 1}단계`}>
            <div style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
          <button type="button" className="onb-skipall" onClick={skipAll}>나중에 할게요</button>
        </div>

        {step === 0 && (
          <section className="onb-step">
            <h2>{name ? `${name}님, 반가워요 👋` : "반가워요 👋"}<br />어떤 걸 좋아하세요?</h2>
            <p>여러 개 골라도 돼요. 비슷한 동행을 찾는 데 써요.</p>
            <div className="onb-tiles">
              {INTERESTS.map(({ value, emoji }) => (
                <button key={value} type="button" className={`onb-tile ${form.interests.includes(value) ? "on" : ""}`} aria-pressed={form.interests.includes(value)} onClick={() => set("interests", toggleInList(form.interests, value))}>
                  <span className="emo">{emoji}</span>{value}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="onb-step">
            <h2>축제는 어떻게 즐기는 편이에요? 🎪</h2>
            <p>하나만 골라 주세요.</p>
            <div className="onb-cards">
              {STYLES.map(({ value, emoji, desc }) => (
                <button key={value} type="button" className={`onb-card ${form.travelStyle === value ? "on" : ""}`} aria-pressed={form.travelStyle === value} onClick={() => set("travelStyle", form.travelStyle === value ? "" : value)}>
                  <span className="emo">{emoji}</span>
                  <b>{value}</b>
                  <small>{desc}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="onb-step">
            <h2>마지막! MBTI를 알려 주세요 ✨</h2>
            <p>프로필에 보이는 TMI예요. 알려 주기 싫으면 비워 둬도 돼요.</p>
            <button type="button" className={`onb-card single ${form.mbti === "" ? "on" : ""}`} onClick={() => set("mbti", "")}>
              <span className="emo">🤫</span>
              <b>비공개할래요</b>
              <small>MBTI 없이 진행해요</small>
            </button>
            <div className="onb-mbti">
              {MBTIS.map((m) => (
                <button key={m} type="button" className={`btn small ${form.mbti === m ? "selected" : ""}`} onClick={() => set("mbti", form.mbti === m ? "" : m)}>
                  {m}
                </button>
              ))}
            </div>
          </section>
        )}

        {error && <p className="auth-msg error" role="alert">{error}</p>}

        {/* 아래: 이전 · 다음 버튼을 나란히 (엄지로 누르기 쉽게) */}
        <div className="onb-nav">
          {step > 0 && (
            <button type="button" className="btn onb-prev" onClick={prev} disabled={busy}>
              이전
            </button>
          )}
          <button type="button" className="btn primary onb-next" onClick={next} disabled={busy}>
            {busy ? "저장 중…" : isLast ? "완료하고 시작하기 🎉" : "다음"}
          </button>
        </div>
      </div>
    </div>
  );
}
