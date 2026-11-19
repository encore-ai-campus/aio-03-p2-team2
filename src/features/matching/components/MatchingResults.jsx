import { useState } from "react";
import { Link } from "react-router-dom";
import CreatePostBox from "../../groups/components/CreatePostBox.jsx";
import { recruitmentJoinMode } from "../lib/matchingConditions.js";
import { formatMatchingDate } from "../lib/matchingDates.js";

// 실제 API 매칭 결과 — v3: 후보 목록(합류 시각·공통점) + 「이 조건으로 모집할까요?」 박스
const REASON_ICON = (r) => (/합류|시/.test(r) ? "ti-clock" : /나이/.test(r) ? "ti-user" : /관심|취향/.test(r) ? "ti-heart" : /예산/.test(r) ? "ti-wallet" : /스타일/.test(r) ? "ti-walk" : "ti-check");
export default function MatchingResults({ run, festival, profile, summary, joinLabel, onEdit }) {
  const [picked, setPicked] = useState([]); // 함께하고 싶은 동행 id (모집글 초안에 들어감)
  const [saving, setSaving] = useState(false);
  if (run.status === "loading")
    return (
      <div className="ws-body ws-pad">
        <div className="ws-title"><h2>추천 동행</h2></div>
        <div className="cand-skel" aria-busy="true" aria-label="잘 맞는 동행을 찾는 중">
          {[0, 1, 2].map((i) => <span key={i} />)}
        </div>
      </div>
    );
  if (run.status === "error")
    return (
      <div className="ws-body ws-pad">
        <div className="ws-title"><h2>추천 동행</h2></div>
        <div className="note"><strong>매칭하지 못했어요</strong><br />{run.error}</div>
      </div>
    );
  const candidates = run.result?.candidates || [];
  const date = run.conditions?.date || profile.date;
  const start = run.conditions?.startTime || profile.start;
  const party = Number(run.partySize || profile.party) || 2;
  const max = Math.max(party - 1, 1); // 나를 뺀 모집 인원까지 고를 수 있음
  if (!candidates.length)
    return (
      <div className="ws-body ws-pad">
        <div className="ws-title"><h2>추천 동행 <span>0명</span></h2></div>
        <div className="cand-none">
          <i className="ti ti-user-search" aria-hidden="true" />
          <h3>이 조건에 맞는 동행이 아직 없어요</h3>
          <p>
            {[date && formatMatchingDate(date, "."), start && `${start} 시작`].filter(Boolean).join(" · ") || "지금 조건"}으로는 잘 맞는 동행을 찾지 못했어요.
            <br />
            조건을 바꿔 보거나, 모집글을 먼저 올려 동행을 기다려 보세요.
          </p>
          <div className="cand-none-actions">
            {onEdit && (
              <button type="button" className="cand-none-btn" onClick={onEdit}>
                <i className="ti ti-adjustments-horizontal" aria-hidden="true" /> 조건 바꾸기
              </button>
            )}
            <Link to="/groups" className="cand-none-btn primary">
              <i className="ti ti-pencil-plus" aria-hidden="true" /> 커뮤니티에 모집글 올리기
            </Link>
          </div>
        </div>
      </div>
    );
  const toggle = (id) =>
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (max === 1) return [id]; // 1명 모집이면 선택이 옮겨감
      return cur.length < max ? [...cur, id] : cur; // 여러 명이면 최대 수까지 중복 선택
    });
  const full = max > 1 && picked.length >= max;
  const names = candidates.filter((o) => picked.includes(o.id)).map((o) => o.name);
  return (
    <>
      <div className="ws-head">
        <div className="ws-title">
          <h2>추천 동행 <span>{candidates.length}명</span></h2>
          <div className="pick-count">선택 <b>{picked.length}</b> / {max}명</div>
        </div>
        <p>함께하고 싶은 동행을 골라 주세요. 모집글에 함께 담겨요.</p>
      </div>
      <div className="ws-body">
        <div className="pick-list" role="group" aria-label="추천 동행 선택">
          {candidates.map((o) => {
            const on = picked.includes(o.id);
            return (
              <button
                type="button"
                key={o.id}
                role="checkbox"
                aria-checked={on}
                disabled={saving}
                className={`pick-card${full && !on ? " dim" : ""}`}
                onClick={() => toggle(o.id)}
              >
                <span className="pick-ava">{o.avatarUrl ? <img src={o.avatarUrl} alt="" /> : (o.name || "?").slice(0, 1)}</span>
                <span className="pick-body">
                  <span className="pick-name">
                    <b>{o.name}</b>
                    {o.profile?.availableFrom && (
                      <span className="pick-time" title={`${o.profile.availableFrom}부터 합류 가능`}>
                        <i className="ti ti-clock" aria-hidden="true" />
                        {String(o.profile.availableFrom).slice(0, 5)}~
                      </span>
                    )}
                  </span>
                  <span className="pick-tags">
                    {candidateTags(o, profile).map(([icon, text, hit]) => (
                      <span className={`pick-tag${hit ? " hit" : ""}`} key={text}>
                        <i className={`ti ${icon}`} aria-hidden="true" />
                        {text}
                      </span>
                    ))}
                  </span>
                </span>
                {o.score != null && Number.isFinite(Number(o.score)) && (
                  <span className="pick-score" aria-label={`적합도 ${Math.round(Number(o.score))}%`}>
                    <b>{Math.round(Number(o.score))}<small>%</small></b>
                    <span>적합도</span>
                  </span>
                )}
                <span className="pick-box" aria-hidden="true"><i className="ti ti-check" /></span>
              </button>
            );
          })}
        </div>
        {full && <p className="pick-limit">최대 {max}명까지 고를 수 있어요</p>}
        {onEdit && (
          <div className="pick-tip">
            <i className="ti ti-sparkles" aria-hidden="true" />
            <div>
              <b>더 잘 맞는 동행을 찾고 싶다면</b>
              <span>관심사·스타일·예산을 더하면 더 정확해져요</span>
            </div>
            <button type="button" onClick={onEdit} disabled={saving}>조건 더하기 <i className="ti ti-chevron-right" aria-hidden="true" /></button>
          </div>
        )}
      </div>
      <div className="ws-foot pick-foot">
        <div className="pick-info">
          <div>
            <span className="k">일정</span> {date ? `${formatMatchingDate(date, ".")} ${start || ""}` : "미정"} · <span className="k">모집</span> 나 포함 {party}명{joinLabel ? ` · ${joinLabel}` : ""}
          </div>
          <div>
            <span className="k">함께할 동행</span> {names.length ? <b>{names.join(", ")}</b> : "아직 고르지 않았어요"}
          </div>
        </div>
        <CreatePostBox
          cta
          festival={festival}
          runId={run.runId}
          partySize={party}
          joinMode={recruitmentJoinMode(run.runId, profile.joinMode)}
          summary={summary}
          selectedCompanions={names}
          onBusyChange={setSaving}
          date={date}
          startTime={start}
        />
      </div>
    </>
  );
}

// 후보 카드 태그: 프로필 요약(합류 시각·연령대·여행 스타일·관심사) — 내 조건과 겹치는 값은 강조
function candidateTags(o, mine = {}) {
  const p = o.profile || {};
  const text = (o.reasons || []).join(" ");
  const hitInterests = (text.match(/관심사 \d+개 일치\(([^)]*)\)/)?.[1] || "").split(",").map((x) => x.trim()).filter(Boolean);
  const tags = [];
  if (p.ageBand) tags.push(["ti-user", p.ageBand, /같은 나이대/.test(text)]);
  // 강조 기준: 이번 검색 조건과 겹침(추천 이유) 또는 내 프로필(온보딩 선호)과 같음
  if (p.travelStyle) tags.push(["ti-route", p.travelStyle, /여행 스타일 같음/.test(text) || (!!mine.style && (String(mine.style).includes(p.travelStyle) || p.travelStyle.includes(mine.style)))]);
  // 관심사는 한 태그로 묶어 줄바꿈을 줄임 (예: 음악 · 미식 · 카페) — 이번 조건과 겹치는 관심사를 앞에, 최대 3개
  const myInts = mine.interests || [];
  const allInts = p.interests || [];
  const hitInts = allInts.filter((x) => hitInterests.includes(x) || myInts.includes(x));
  const ints = [...hitInts, ...allInts.filter((x) => !hitInts.includes(x))].slice(0, 3);
  if (ints.length) tags.push(["ti-heart", ints.join(" · "), ints.some((x) => hitInterests.includes(x) || myInts.includes(x))]);
  if (!tags.length) (o.reasons || []).forEach((r) => tags.push([REASON_ICON(r), r, true]));
  return tags;
}
