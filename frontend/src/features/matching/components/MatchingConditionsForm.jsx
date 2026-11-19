import { Button } from "../../../shared/components/Primitives.jsx";
import TimeSelect from "../../../shared/components/TimeSelect.jsx";

const INTERESTS = ["미식", "사진", "산책", "음악", "문화", "전통", "자연", "카페", "액티비티"];
// 온보딩과 같은 이모지로 통일
const INTEREST_EMOJI = { 미식: "🍜", 사진: "📸", 산책: "🚶", 음악: "🎵", 문화: "🎨", 전통: "🏮", 자연: "🌳", 카페: "☕", 액티비티: "🎢" };
const STYLE_EMOJI = { 여유롭게: "🌿", 활동적으로: "⚡", 계획적으로: "📋" };
const JOIN_OPTIONS = [
  ["approval", "✋ 승인 후 참여"],
  ["instant", "🚀 바로 참여"],
];
const MBTIS = [
  "ISTJ", "ISFJ", "INFJ", "INTJ", "ISTP", "ISFP", "INFP", "INTP",
  "ESTP", "ESFP", "ENFP", "ENTP", "ESTJ", "ESFJ", "ENFJ", "ENTJ",
];

export default function MatchingConditionsForm({ festivals, festival, profile, form, submitting, formMessage, optOpen, setOptOpen, onSubmit }) {
  return (
    <div className="form-body form-v3">
      <div className="form-group-title">필수 조건</div>
      <div className="form-req">
        <div className="field">
          <label htmlFor="match-festival">참여할 축제</label>
          <select id="match-festival" {...form.fields.festival}>
            <option value="">축제 선택</option>
            {festivals.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {form.formatFestivalDate(x.start)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="match-date">참여 날짜</label>
          <input
            id="match-date"
            type="date"
            min={festival?.start}
            max={festival?.end}
            value={profile.date || ""}
            onChange={(e) => form.changeDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="match-start">합류 가능 시각</label>
          <TimeSelect id="match-start" label="합류 가능 시각" {...form.fields.start} />
        </div>
        <div className="field">
          <label htmlFor="match-cap">모임 정원</label>
          <select id="match-cap" {...form.fields.party}>
            <option value="">선택</option>
            {[2, 3, 4, 5, 6, 7, 8].map((x) => (
              <option key={x} value={x}>
                {x}명
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 매칭 실행: 필수 조건 바로 아래 (선택 조건을 펼치지 않아도 바로 실행) */}
      <div className="form-run">
        <details className="fold score-info">
          <summary>
            <i className="ti ti-info-circle" aria-hidden="true" /> 점수 계산 방식
          </summary>
          <div className="score-grid">
            <span>합류 시간 20%</span>
            <span>관심사 20%</span>
            <span>예산 15%</span>
            <span>여행 스타일 15%</span>
            <span>연령대 10%</span>
            <span>희망 인원 10%</span>
            <span>성별 5%</span>
            <span>MBTI 5%</span>
          </div>
          <p>선택 조건을 비워 두면 그 항목은 빼고 나머지로 100점 기준을 다시 계산해요. 60% 이상인 동행을 추천해요.</p>
        </details>
        <button type="button" className="btn primary" disabled={submitting} onClick={onSubmit}>
          {submitting ? "매칭 중…" : "이 조건으로 매칭하기"}
        </button>
        {formMessage && <p className="run-hint" role="alert"><strong>{formMessage}</strong></p>}
      </div>

      {/* 선택 조건: 기본 접힘 · 한 줄에 한 항목(왼쪽 소제목 / 오른쪽 선택) */}
      <details
        className="opt-fold"
        open={optOpen}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          if (open !== optOpen) setOptOpen(open);
        }}
      >
        <summary>
          <span className="opt-title">
            <i className="ti ti-help-circle" aria-hidden="true" /> 더 잘 맞는 동행을 찾으려면 <em>(선택)</em>
          </span>
          <span className="opt-sum">
            {[profile.style, profile.budget && `${profile.budget}만원`, profile.interests.length && profile.interests.join(", "), profile.mbti.length && profile.mbti.join("/")]
              .filter(Boolean)
              .join(" · ") || "비워 두면 점수에서 빠져요"}
          </span>
          <i className="ti ti-chevron-down chev" aria-hidden="true" />
        </summary>
        <div className="opt-rows">
          <div className="opt-row">
            <span className="opt-label">여행 스타일</span>
            <div className="seg seg-3" role="group" aria-label="여행 스타일">
              {["여유롭게", "활동적으로", "계획적으로"].map((x) => (
                <button
                  key={x}
                  type="button"
                  className={profile.style === x ? "on" : ""}
                  aria-pressed={profile.style === x}
                  onClick={() => form.toggleStyle(x)}
                >
                  {STYLE_EMOJI[x]} {x}
                </button>
              ))}
            </div>
          </div>
          <div className="opt-row">
            <label className="opt-label" htmlFor="match-budget">여행 예산</label>
            {/* 직접 입력 — 온보딩·챗봇에서 정한 값이 있으면 미리 채워진다(위 채우기 로직) */}
            <div className="budget-field">
              <div className="budget-input">
                <input
                  id="match-budget"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  step={1}
                  placeholder="예) 8"
                  value={profile.budget || ""}
                  onChange={(e) => form.changeBudget(e.target.value)}
                />
                <span>만 원</span>
              </div>
              <small>1인 기준 · 예) 5, 10, 15 · 비워 두면 예산은 보지 않아요</small>
            </div>
          </div>
          <div className="opt-row">
            <span className="opt-label">
              관심사 <small>여러 개</small>
            </span>
            <div className="grid-chips g5">
              {INTERESTS.map((x) => (
                <Button key={x} className={`chip ${profile.interests.includes(x) ? "active" : ""}`} onClick={() => form.toggleInterest(x)}>
                  {INTEREST_EMOJI[x]} {x}
                </Button>
              ))}
            </div>
          </div>
          <div className="opt-row">
            <span className="opt-label">
              선호 MBTI <small>여러 개</small>
            </span>
            <div className="grid-chips g8">
              {MBTIS.map((x) => (
                <Button key={x} className={`chip ${profile.mbti.includes(x) ? "active" : ""}`} onClick={() => form.toggleMbti(x)}>
                  {x}
                </Button>
              ))}
            </div>
          </div>
          <div className="opt-row">
            <span className="opt-label">참여 방식</span>
            <div className="seg seg-2" role="group" aria-label="참여 방식">
              {JOIN_OPTIONS.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={(profile.joinMode || "approval") === v ? "on" : ""}
                  aria-pressed={(profile.joinMode || "approval") === v}
                  onClick={() => form.changeJoinMode(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
