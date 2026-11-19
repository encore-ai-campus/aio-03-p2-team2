// 마이페이지 — 온보딩에서 입력한 값을 GET /me 로 불러와 한 화면에서 바로 수정 (PATCH /me/profile)
import { useEffect, useState } from "react";
import { apiFetch } from "../../../shared/lib/apiClient.js";
import { useAuth } from "../AuthProvider.jsx";
import TimeSelect from "../../../shared/components/TimeSelect.jsx";
import {
  AGE_BANDS, BUDGETS, EMPTY_FORM, GENDERS, INTERESTS, JOIN_MODES, MBTIS, PARTY_SIZES, STYLES, TIMES,
  fromProfile, toProfileBody, toggleInList,
} from "../lib/profileOptions.js";
import "../auth.css";

export default function ProfilePage() {
  const { user } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "error" | "notice", text }
  const [riskAlert, setRiskAlert] = useState(false); // 악천후 알림 수신 (꺼져 있으면 알림이 생성되지 않음)

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // 처음 열 때 저장된 값 불러오기
  useEffect(() => {
    apiFetch("/me")
      .then((me) => {
        setForm(fromProfile(me?.profile));
        setRiskAlert(!!me?.notificationConsent?.riskAlert);
      })
      .catch(() => setLoadError("저장된 프로필을 불러오지 못했어요. (백엔드 서버 확인 필요) 입력 후 저장은 할 수 있어요."));
  }, []);

  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      const me = await apiFetch("/me/profile", { method: "PATCH", body: toProfileBody(form) });
      if (me?.profile) setForm(fromProfile(me.profile));
      setMsg({ type: "notice", text: "저장했어요 ✅" });
    } catch (err) {
      setMsg({ type: "error", text: err.status ? `저장하지 못했어요 (${err.status} ${err.code || ""})` : "서버에 연결할 수 없어요." });
    } finally {
      setBusy(false);
    }
  }

  // 알림 수신은 누르는 즉시 저장 (PATCH /me/notification-consents)
  async function toggleRiskAlert() {
    const next = !riskAlert;
    setRiskAlert(next);
    try {
      await apiFetch("/me/notification-consents", { method: "PATCH", body: { riskAlert: next } });
      setMsg({ type: "notice", text: next ? "악천후 알림을 켰어요 🔔" : "악천후 알림을 껐어요" });
    } catch (err) {
      setRiskAlert(!next);
      setMsg({ type: "error", text: err.status ? `알림 설정을 바꾸지 못했어요 (${err.status} ${err.code || ""})` : "서버에 연결할 수 없어요." });
    }
  }

  return (
    <div className="profile-page">
      <div className="auth-card wide">
        <div>
          <h2 className="onb-title">👤 {user?.user_metadata?.display_name || "내"} 프로필</h2>
          <p className="onb-sub">{user?.email} · 누르면 바로 바뀌고, 저장을 눌러야 반영돼요.</p>
        </div>
        {loadError && <p className="auth-msg error">{loadError}</p>}

        <div className="pf-group">
          <b>🙂 나에 대해</b>
          <small>온보딩에서 입력한 정보예요.</small>
        </div>

        <div className="pf-section">
          <div className="onb-label">🪪 기본 정보 <small className="muted">(선택 · 비워 두면 공개하지 않아요)</small></div>
          <div className="onb-chips">
            {GENDERS.map(({ value, emoji }) => (
              <button key={value} type="button" className={`btn small ${form.gender === value ? "selected" : ""}`} onClick={() => set("gender", form.gender === value ? "" : value)}>
                {emoji} {value}
              </button>
            ))}
            <span className="muted" style={{ margin: "0 4px" }}>·</span>
            {AGE_BANDS.map((a) => (
              <button key={a} type="button" className={`btn small ${form.ageBand === a ? "selected" : ""}`} onClick={() => set("ageBand", form.ageBand === a ? "" : a)}>
                {a}
              </button>
            ))}
          </div>
        </div>

        <div className="pf-section">
          <div className="onb-label">🎯 관심사</div>
          <div className="onb-chips">
            {INTERESTS.map(({ value, emoji }) => (
              <button key={value} type="button" className={`btn small ${form.interests.includes(value) ? "selected" : ""}`} onClick={() => set("interests", toggleInList(form.interests, value))}>
                {emoji} {value}
              </button>
            ))}
          </div>
        </div>

        <div className="pf-section">
          <div className="onb-label">🎪 여행 스타일</div>
          <div className="onb-chips">
            {STYLES.map(({ value, emoji }) => (
              <button key={value} type="button" className={`btn small ${form.travelStyle === value ? "selected" : ""}`} onClick={() => set("travelStyle", form.travelStyle === value ? "" : value)}>
                {emoji} {value}
              </button>
            ))}
          </div>
        </div>

        <div className="pf-section">
          <div className="onb-label">✨ 내 MBTI</div>
          <div className="onb-chips">
            <button type="button" className={`btn small ${form.mbti === "" ? "selected" : ""}`} onClick={() => set("mbti", "")}>
              🤫 비공개
            </button>
          </div>
          <div className="onb-mbti">
            {MBTIS.map((m) => (
              <button key={m} type="button" className={`btn small ${form.mbti === m ? "selected" : ""}`} onClick={() => set("mbti", form.mbti === m ? "" : m)}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="pf-group">
          <b>⚙️ 매칭 기본값</b>
          <small>AI 동행 매칭에서 매번 다시 정할 수 있어요. 여기 값은 처음에 채워 둘 기본값이에요.</small>
        </div>

        <div className="pf-section">
          <div className="onb-label">💰 1인 예산</div>
          <div className="onb-chips">
            {BUDGETS.map((b) => (
              <button key={b} type="button" className={`btn small ${Number(form.budgetManwon) === b ? "selected" : ""}`} onClick={() => set("budgetManwon", b)}>
                {b}만원
              </button>
            ))}
            <label className="onb-inline">
              직접
              <input type="number" min={1} max={1000} value={form.budgetManwon} onChange={(e) => set("budgetManwon", e.target.value)} />만원
            </label>
          </div>
        </div>

        <div className="pf-section">
          <div className="onb-label">👥 함께 갈 인원 (나 포함)</div>
          <div className="onb-chips">
            {PARTY_SIZES.map((n) => (
              <button key={n} type="button" className={`btn small ${Number(form.preferredPartySize) === n ? "selected" : ""}`} onClick={() => set("preferredPartySize", n)}>
                {n}명
              </button>
            ))}
          </div>
        </div>

        <div className="pf-section">
          <div className="onb-label">⏰ 합류 가능 시각</div>
          <div className="onb-chips">
            {TIMES.map(({ value, emoji, label }) => (
              <button key={value} type="button" className={`btn small ${form.availableFrom === value ? "selected" : ""}`} onClick={() => set("availableFrom", value)}>
                {emoji} {label} {value}
              </button>
            ))}
            <TimeSelect label="합류 가능 시각" className="onb-time-select" value={form.availableFrom} onChange={(e) => set("availableFrom", e.target.value)} />
          </div>
        </div>

        <div className="pf-section">
          <div className="onb-label">🙋 모임 참여 방식</div>
          <div className="onb-chips">
            {JOIN_MODES.map(({ value, emoji, label }) => (
              <button key={value} type="button" className={`btn small ${form.defaultJoinMode === value ? "selected" : ""}`} onClick={() => set("defaultJoinMode", value)}>
                {emoji} {label}
              </button>
            ))}
          </div>
        </div>

        <div className="pf-group">
          <b>🔔 알림</b>
          <small>참여 예정 모임 날짜에 악천후가 예보되면 알려 드리고, 대체 축제를 제안해요.</small>
        </div>
        <div className="pf-section">
          <div className="onb-chips">
            <button type="button" className={`btn small ${riskAlert ? "selected" : ""}`} aria-pressed={riskAlert} onClick={toggleRiskAlert}>
              {riskAlert ? "☔ 악천후 알림 받는 중" : "☔ 악천후 알림 받기"}
            </button>
          </div>
        </div>

        {msg && <p className={`auth-msg ${msg.type}`} role="status">{msg.text}</p>}
        <div className="onb-bottom">
          <span />
          <button type="button" className="btn primary" onClick={save} disabled={busy}>
            {busy ? "저장 중…" : "저장하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
