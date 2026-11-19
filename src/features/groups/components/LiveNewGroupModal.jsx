// 「＋ 직접 모임 만들기」 — 실제 API 버전 (POST /groups, 만든 사람이 모임장, 승인제 고정)
// 축제는 참여 가능한 것만(종료·취소 제외), 날짜는 축제 기간 안에서만, 합류 시간은 선택
import { useEffect, useMemo, useRef, useState } from "react";
import { createGroup } from "../api/groupsApi.js";
import TimeSelect from "../../../shared/components/TimeSelect.jsx";
import "./newGroup.css";

const ERROR_TEXT = {
  FESTIVAL_NOT_AVAILABLE: "종료되었거나 이용할 수 없는 축제예요. 다른 축제를 골라 주세요.",
  MATCHING_DATE_INVALID: "축제 기간 안의 날짜를 골라 주세요.",
  VALIDATION_ERROR: "입력값을 다시 확인해 주세요.",
};
const msg = (e) => ERROR_TEXT[e?.code] || e?.message || "모집글을 올리지 못했어요.";
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const todayStr = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};
const md = (s) => (s ? `${Number(s.slice(5, 7))}.${Number(s.slice(8, 10))}` : "");
const dayLabel = (s) => {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(+d) ? s : `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
};
const CAPS = [2, 3, 4, 5, 6, 7, 8];
// 날짜·시간 칸 아무 곳이나 눌러도 달력·시간 선택창 열기 (지원 안 하는 브라우저는 기본 동작)
const openPicker = (e) => {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    /* 이미 열려 있거나 미지원 */
  }
};

export default function LiveNewGroupModal({ festivals, onClose, onCreated }) {
  const today = todayStr();
  const [query, setQuery] = useState("");
  const [festivalId, setFestivalId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [title, setTitle] = useState("");
  const [capacity, setCapacity] = useState(4);
  const [postBody, setPostBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef(null);

  // 참여 가능한 축제: 종료·취소 제외, 시작일 가까운 순
  const options = useMemo(
    () =>
      (festivals || [])
        .filter((f) => f.riskStatus !== "cancelled" && (f.end || f.start || "") >= today)
        .sort((a, b) => String(a.start).localeCompare(String(b.start))),
    [festivals, today],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((f) => [f.name, f.region, f.city].join(" ").toLowerCase().includes(q)) : options;
  const fest = options.find((f) => f.id === festivalId);
  const minDate = fest ? (fest.start > today ? fest.start : today) : "";
  const maxDate = fest?.end || fest?.start || "";

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  function pick(f) {
    setFestivalId(f.id);
    setError("");
    // 고른 날짜가 새 축제 기간 밖이면 비움
    if (date && (date < (f.start > today ? f.start : today) || date > (f.end || f.start))) setDate("");
  }

  // 체험용 예시 채우기
  function fillExample() {
    const name = fest?.name || "축제";
    setTitle(`${name} 같이 즐길 동행 구해요`.slice(0, 45));
    setPostBody(
      `${name}에 함께 갈 분을 찾아요.\n` +
        `${date ? `${dayLabel(date)} ` : ""}${startTime ? `${startTime}에 ` : ""}입구 앞에서 만나 같이 둘러볼 예정이에요.\n` +
        "사진 찍는 것 좋아하는 분, 천천히 구경하는 분 모두 환영해요. 끝나고 근처에서 간단히 식사도 해요!",
    );
  }

  const ready = festivalId && title.trim() && postBody.trim() && !busy;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const group = await createGroup({
        festivalId,
        title: title.trim(),
        postBody: postBody.trim(),
        capacity,
        joinMode: "approval",
        date: date || null,
        startTime: date && startTime ? startTime : null,
      });
      onCreated(group);
    } catch (err) {
      console.warn("[groups] 모집글 생성 실패", err);
      setError(msg(err));
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form className="modal ng-modal" role="dialog" aria-modal="true" aria-labelledby="ng-title" onSubmit={submit}>
        <div className="modal-head">
          <h2 id="ng-title">모집글 직접 쓰기</h2>
          <button type="button" className="ng-x" aria-label="닫기" onClick={onClose} disabled={busy}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <p className="ng-lead">
          <i className="ti ti-crown" aria-hidden="true" /> 글을 올린 사람이 모임장이 되고, 참여 신청은 모임장이 승인해요
        </p>

        {/* 1. 축제 */}
        <div className="ng-field">
          <label htmlFor="ng-search">
            축제 <em>필수</em>
          </label>
          <div className="ng-search">
            <i className="ti ti-search" aria-hidden="true" />
            <input
              id="ng-search"
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="축제 이름이나 지역으로 찾기"
              autoComplete="off"
            />
          </div>
          <div className="ng-fest-list" role="listbox" aria-label="참여 가능한 축제">
            {shown.length ? (
              shown.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="option"
                  aria-selected={f.id === festivalId}
                  className={`ng-fest ${f.id === festivalId ? "on" : ""}`}
                  onClick={() => pick(f)}
                >
                  <span className="ng-fest-name">{f.name}</span>
                  <span className="ng-fest-meta">
                    {[f.region, f.city].filter(Boolean).join(" ") || "지역 미정"} · {md(f.start)}–{md(f.end || f.start)}
                  </span>
                  {f.id === festivalId ? <i className="ti ti-circle-check-filled" aria-hidden="true" /> : null}
                </button>
              ))
            ) : (
              <div className="ng-empty">{options.length ? "검색 결과가 없어요" : "참여 가능한 축제를 불러오는 중이거나 없어요"}</div>
            )}
          </div>
        </div>

        {/* 2. 날짜·합류 시간 */}
        <div className="ng-two">
          <div className="ng-field">
            <label htmlFor="ng-date">
              날짜 <span>선택</span>
            </label>
            <input id="ng-date" type="date" value={date} min={minDate} max={maxDate} disabled={!fest} onClick={openPicker} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="ng-field">
            <label htmlFor="ng-time">
              합류 시간 <span>선택</span>
            </label>
            <TimeSelect id="ng-time" value={startTime} disabled={!date} onChange={(e) => setStartTime(e.target.value)} />
          </div>
        </div>
        {fest ? <p className="ng-hint">축제 기간 {md(minDate)}–{md(maxDate)} 안에서 고를 수 있어요</p> : null}

        {/* 3. 제목 */}
        <div className="ng-field">
          <label htmlFor="ng-name">
            제목 <em>필수</em>
            <span className="ng-count">{title.length}/45</span>
          </label>
          <input id="ng-name" maxLength={45} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예) 토요일 저녁 불꽃놀이 같이 볼 분" />
        </div>

        {/* 4. 정원 */}
        <div className="ng-field">
          <span className="ng-label">정원 (나 포함)</span>
          <div className="ng-caps" role="radiogroup" aria-label="정원">
            {CAPS.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={capacity === n} className={capacity === n ? "on" : ""} onClick={() => setCapacity(n)}>
                {n}명
              </button>
            ))}
          </div>
        </div>

        {/* 5. 모집 글 */}
        <div className="ng-field">
          <label htmlFor="ng-body">
            모집 글 <em>필수</em>
            <button type="button" className="ng-example" onClick={fillExample}>
              예시로 채우기
            </button>
          </label>
          <textarea
            id="ng-body"
            rows={5}
            maxLength={2000}
            value={postBody}
            onChange={(e) => setPostBody(e.target.value)}
            placeholder={"예) 토요일 저녁 7시에 입구 앞에서 만나 같이 둘러봐요.\n사진 찍는 것 좋아하는 분 환영해요. 끝나고 근처에서 간단히 식사도 해요."}
          />
        </div>

        {error ? (
          <div className="ng-error" role="alert">
            <i className="ti ti-alert-circle" aria-hidden="true" /> {error}
          </div>
        ) : null}

        <div className="ng-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="submit" className="btn primary" disabled={!ready}>
            {busy ? "올리는 중…" : "모집글 올리기"}
          </button>
        </div>
      </form>
    </div>
  );
}
