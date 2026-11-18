// 홈(공개) — 서비스 소개 → 이용 절차 4단계 → AI 기능 → 진행 중 축제 → 마무리 띠
// 목업 public/mockup/home.html(v3) 확정본 기준. 로그인 없이 볼 수 있다.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useFestivals } from "../../festivals/hooks/useFestivals.js";
import { useReveal } from "../../../shared/hooks/useReveal.js";
import "../home.css";

const STEPS = [
  {
    no: 1, tag: "축제 고르기", title: ["가고 싶은 축제를", "먼저 골라요"],
    desc: "축제명·지역·유형으로 참여할 수 있는 축제를 찾고, 달력으로 월별 일정도 확인해요.",
    points: ["한국관광공사 축제 정보", "목록·달력 보기"], link: ["/festivals", "축제 탐색하기"],
  },
  {
    no: 2, tag: "AI 동행 매칭", title: ["원하는 동행을", "말로 설명해요"],
    desc: "날짜·시간·인원·분위기를 대화로 알려주면 AI가 조건을 정리하고, 잘 맞는 후보를 일치 점수와 함께 추천해요.",
    points: ["대화에서 조건 자동 정리", "함께할 동행을 직접 선택"], link: ["/matching", "매칭 시작하기"],
  },
  {
    no: 3, tag: "모임 참여·채팅", title: ["모임에 참여하고", "함께 이야기해요"],
    desc: "모집글에 참여를 신청하고, 모임장이 승인하면 채팅방에서 만날 장소와 시간을 정해요.",
    points: ["모임장 승인 후 입장", "정원이 차면 자동 마감"], link: ["/groups", "커뮤니티 보기"],
  },
  {
    no: 4, tag: "일정·날씨 확인", title: ["비가 오면", "AI가 먼저 알려줘요"],
    desc: "모임 시간의 실제 예보를 확인해 비 소식이 있으면 진행 여부를 묻고, 대체 축제나 새 일정을 제안해요.",
    points: ["시간별 강수확률 확인", "대체 축제·새 일정 제안"], link: ["/alerts", "AI 알림 보기"],
  },
];

const FEATURES = [
  { icon: "ti-message-chatbot", title: "대화로 조건 정리", desc: "문장 속 날짜·시간·인원·분위기를 매칭 조건으로 바꿔요. 빠진 조건은 하나씩 다시 물어봐요.", ex: ["예시", "“토요일 저녁, 조용히 즐길 2명”"] },
  { icon: "ti-users-group", title: "일치 점수로 추천", desc: "관심사·연령대·여행 스타일을 비교해 점수가 높은 후보부터 보여주고, 겹치는 조건을 표시해요.", ex: ["기준", "일치 점수 60점 이상만 추천"] },
  { icon: "ti-cloud-rain", title: "날씨 대응", desc: "모임 시간의 실제 예보를 확인하고, 비가 오면 진행 여부를 묻고 대체 축제를 찾아줘요.", ex: ["데이터", "Open-Meteo 시간별 예보"] },
];

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const mmdd = (v) => (v || "").slice(5).replace("-", ".");
const badge = (f, today) => {
  if (f.start <= today) return "진행 중";
  const days = Math.round((new Date(`${f.start}T00:00:00`) - new Date(`${today}T00:00:00`)) / 864e5);
  return `D-${days}`;
};

// 참여 가능 + 사진 있는 축제를 시작일 순으로
function usePreviewFestivals() {
  const { festivals, source } = useFestivals();
  const list = useMemo(() => {
    const today = todayStr();
    return festivals
      .filter((f) => f.end >= today && (f.thumbnailUrl || f.imageUrl))
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 6)
      .map((f) => ({ ...f, img: f.thumbnailUrl || f.imageUrl, badge: badge(f, today) }));
  }, [festivals]);
  return { list, source };
}

function MiniNav({ current }) {
  return (
    <div className="hm-mnav">
      <img src="/brand/fesroam_logo_horizontal.png" alt="" />
      {["축제 탐색", "AI 동행 매칭", "커뮤니티", "내 모임"].map((m) => (
        m === current ? <b key={m}>{m}</b> : <span key={m}>{m}</span>
      ))}
    </div>
  );
}
function Bar({ path }) {
  return (
    <div className="hm-bar">
      <i /><i /><i /><span>fesroam / {path}</span>
    </div>
  );
}

// 오른쪽 고정 무대의 미니 화면 4개 — 실제 화면 구성을 그대로 줄인 것
function Screens({ step, festivals }) {
  const six = festivals.length ? festivals : Array.from({ length: 6 }, (_, i) => ({ id: `ph${i}` }));
  return (
    <div className="hm-stage" aria-hidden="true">
      <div className={`hm-screen ${step === 0 ? "on" : ""}`}>
        <Bar path="축제 탐색" />
        <MiniNav current="축제 탐색" />
        <div className="hm-mbody">
          <div className="hm-mh"><div><b>축제 탐색</b><span>참여할 수 있는 축제를 찾아보세요</span></div><span>한국관광공사 TourAPI</span></div>
          <div className="hm-fbar">
            <div className="hm-inp"><i className="ti ti-search" />축제명·지역·태그 검색</div>
            <div className="hm-sel">참여 가능<i className="ti ti-chevron-down" /></div>
            <div className="hm-sel">전국 지역<i className="ti ti-chevron-down" /></div>
            <div className="hm-sel">전체 유형<i className="ti ti-chevron-down" /></div>
          </div>
          <div className="hm-months">
            <span className="on">전체</span><span>11월</span><span>12월</span><span>1월</span><span>2월</span>
            <div className="hm-vt"><span className="on">목록</span><span>달력</span></div>
          </div>
          <div className="hm-fgrid">
            {six.map((f) => (
              <div className="hm-fc" key={f.id}>
                <div className="hm-im" style={f.img ? { backgroundImage: `url("${f.img}")` } : undefined}>{f.badge && <b>{f.badge}</b>}</div>
                <div className="hm-tx"><div className="t">{f.name || " "}</div><div className="m">{f.name ? `${f.city || f.region} · ~${mmdd(f.end)}` : " "}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`hm-screen ${step === 1 ? "on" : ""}`}>
        <Bar path="AI 동행 매칭" />
        <MiniNav current="AI 동행 매칭" />
        <div className="hm-mbody">
          <div className="hm-mh"><div><b>AI 동행 매칭</b><span>남산봉수의식 등 전통문화행사 · 서울 종로구</span></div></div>
          <div className="hm-two">
            <div className="hm-card">
              <div className="hm-ct">AI 챗봇<span>조건 3/3</span></div>
              <div className="hm-msg me">토요일 저녁 7시에 2명이서 조용히 구경하고 싶어</div>
              <div className="hm-msg ai">조건을 정리했어요. 잘 맞는 후보 3명을 찾았어요.</div>
              <div className="hm-slot"><span>토요일</span><span>19:00</span><span>2명</span><span>여유롭게</span></div>
              <div className="hm-chatin">조건을 더 말해 보세요<i className="ti ti-arrow-up" /></div>
            </div>
            <div className="hm-card">
              <div className="hm-ct">추천 동행 3명<span>일치 점수 60점 이상</span></div>
              {[
                ["하늘", "19:00", [["20대", 1], ["여유롭게", 1], ["전통·사진", 0]], 86, true],
                ["도윤", "18:30", [["20대", 1], ["활동적", 0], ["야경", 0]], 78, false],
                ["서연", "19:30", [["30대", 0], ["여유롭게", 1], ["산책", 0]], 71, false],
              ].map(([n, t, tags, s, sel]) => (
                <div className={`hm-cand ${sel ? "sel" : ""}`} key={n}>
                  <div className="hm-ck">{sel && <i className="ti ti-check" />}</div>
                  <div><div className="hm-cn">{n}<small>🕐 {t}~</small></div><div className="hm-tags">{tags.map(([x, hit]) => <span key={x} className={hit ? "hit" : ""}>{x}</span>)}</div></div>
                  <div className="hm-score">{s}<small>점</small></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="hm-mfoot"><span>함께할 동행 <b>1</b>/1명 선택</span><span className="hm-mbtn">모집글 만들기</span></div>
      </div>

      <div className={`hm-screen ${step === 2 ? "on" : ""}`}>
        <Bar path="모임 채팅방" />
        <MiniNav current="커뮤니티" />
        <div className="hm-mbody">
          <div className="hm-mh"><div><b>남산봉수의식 같이 즐길 동행 구해요</b><span>토요일 19:00 · 서울특별시 종로구</span></div><span className="hm-pill g">정원 마감 2/2</span></div>
          <div className="hm-room">
            <div className="hm-card">
              <div className="hm-notice">하늘님이 모임에 참여했어요</div>
              <div className="hm-bub"><div className="av"><i className="ti ti-user" /></div><div><div className="nm">하늘</div><div className="tx">7시에 남산 케이블카 앞 어때요?</div></div></div>
              <div className="hm-bub me"><div className="tx">좋아요! 그때 봬요 🙂</div></div>
              <div className="hm-bub"><div className="av"><i className="ti ti-user" /></div><div><div className="nm">하늘</div><div className="tx">비 오면 실내 행사로 바꿔도 괜찮아요</div></div></div>
              <div className="hm-chatin">메시지 입력<i className="ti ti-send" /></div>
            </div>
            <div className="hm-card">
              <div className="hm-ct">참여자<span>2/2명</span></div>
              <div className="hm-prow"><span>나</span><span className="hm-pill host">모임장</span></div>
              <div className="hm-prow"><span>하늘</span><span className="hm-pill">참여</span></div>
              <div className="hm-ct" style={{ marginTop: 12 }}>모임 정보</div>
              <div className="hm-prow"><span>승인제</span><span className="hm-pill g">마감</span></div>
              <div className="hm-prow"><span>만날 시간</span><span>19:00</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className={`hm-screen ${step === 3 ? "on" : ""}`}>
        <Bar path="AI 알림·대안" />
        <MiniNav current="내 모임" />
        <div className="hm-mbody">
          <div className="hm-mh"><div><b>AI 알림·대체 축제</b><span>모임 날짜의 실제 예보를 확인해요</span></div><span>01 날씨 확인 · <em>02 진행 여부</em> · 03 대체 축제</span></div>
          <div className="hm-band"><div className="ic"><i className="ti ti-cloud-rain" /></div><div><b>모임 시간에 비 예보가 있어요</b><small>강수확률 최대 100% · 판단 기준 60% 이상</small></div><span className="hm-mbtn">진행 여부 정하기</span></div>
          <div className="hm-wgrid">
            <div className="hm-card">
              <div className="hm-ct">모임 시간 날씨<span>Open-Meteo 실시간 예보</span></div>
              <div className="hm-big"><div><small>최대 강수확률</small><div className="n">100%</div></div><div className="hm-chips3"><div>비 예보<b>3/3시간</b></div><div>최대 바람<b>0.7m/s</b></div><div>판단 기준<b>60%</b></div></div></div>
              <div className="hm-ht">
                <div className="l">시간</div><div>19시</div><div>20시</div><div>21시</div>
                <div className="l">날씨</div><div><i className="ti ti-cloud-rain" /></div><div><i className="ti ti-cloud-rain" /></div><div><i className="ti ti-cloud-rain" /></div>
                <div className="l">강수확률</div><div className="v">100</div><div className="v">100</div><div className="v">97</div>
              </div>
            </div>
            <div className="hm-card">
              <div className="hm-ct">모임 정보</div>
              <div className="hm-tl"><b>19:00</b><span>남산봉수의식 등 전통문화행사</span></div>
              <div className="hm-ct" style={{ marginTop: 6 }}>참여자<span>2/2명</span></div>
              <div className="hm-prow flat"><span>나</span><span className="hm-pill host">모임장</span></div>
              <div className="hm-prow flat"><span>하늘</span><span className="hm-pill">참여</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 2단계 연출: 화면 가운데 띠에 들어온 단계를 현재 단계로
function useActiveStep(count) {
  const [step, setStep] = useState(0);
  const refs = useRef([]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setStep(Number(e.target.dataset.step))),
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.slice(0, count).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [count]);
  return [step, refs];
}

export default function HomePage() {
  const { list, source } = usePreviewFestivals();
  const [step, stepRefs] = useActiveStep(STEPS.length);
  const pageRef = useReveal([source]);
  const { hash } = useLocation();
  // 푸터 「이용 방법」(/#flow)으로 들어오면 해당 섹션으로 이동
  useEffect(() => {
    if (hash === "#flow") document.getElementById("flow")?.scrollIntoView();
  }, [hash]);

  return (
    <div className="hm" ref={pageRef}>
      <section className="hm-hero hm-photo">
        <div className="hm-wrap">
          <div className="hm-eye reveal">축제 동행 매칭 서비스 · 페스로움</div>
          <h1 className="reveal d1">가고 싶은 축제에<br />함께 갈 사람을 찾아요</h1>
          <p className="reveal d2">축제 날짜와 시간대, 원하는 분위기를 알려주세요.<br />AI가 조건을 확인하고 동행 후보를 추천해드려요.</p>
          <div className="hm-cta reveal d3">
            <Link className="hm-btn primary" to="/festivals">축제 둘러보기 <i className="ti ti-arrow-right" aria-hidden="true" /></Link>
            <a className="hm-btn ghost" href="#flow">이용 방법 보기</a>
          </div>
        </div>
        <a className="hm-cue" href="#flow">스크롤해서 알아보기<i className="ti ti-chevron-down" aria-hidden="true" /></a>
      </section>

      <section className="hm-blk" id="flow">
        <div className="hm-wrap">
          <div className="hm-sh reveal">
            <div className="k">이용 방법</div>
            <h2>축제 고르기부터 당일 날씨까지<br />4단계로 이어져요</h2>
          </div>
          <div className="hm-flow">
            <div className="hm-steps">
              {STEPS.map((s, i) => (
                <div key={s.no} data-step={i} ref={(el) => (stepRefs.current[i] = el)} className={`hm-step ${step === i ? "on" : ""}`}>
                  <div className="no"><em>{s.no}</em>{s.tag}</div>
                  <h3>{s.title[0]}<br />{s.title[1]}</h3>
                  <p>{s.desc}</p>
                  <ul>{s.points.map((p) => <li key={p}><i className="ti ti-check" aria-hidden="true" />{p}</li>)}</ul>
                  <Link className="go" to={s.link[0]}>{s.link[1]} <i className="ti ti-chevron-right" aria-hidden="true" /></Link>
                </div>
              ))}
            </div>
            <Screens step={step} festivals={list} />
          </div>
        </div>
      </section>

      <section className="hm-blk gray">
        <div className="hm-wrap">
          <div className="hm-sh reveal">
            <div className="k">AI 기능</div>
            <h2>번거로운 확인은 AI가 맡아요</h2>
            <p>여러 AI 에이전트가 조건 정리, 후보 추천, 일정·날씨 확인을 나눠서 처리해요.</p>
          </div>
          <div className="hm-feat">
            {FEATURES.map((f, i) => (
              <div key={f.title} className={`hm-fcard reveal ${i ? `d${i}` : ""}`}>
                <div className="ic"><i className={`ti ${f.icon}`} aria-hidden="true" /></div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
                <div className="ex"><b>{f.ex[0]}</b>{f.ex[1]}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="hm-blk">
        <div className="hm-wrap">
          <div className="hm-sh row reveal">
            <div><div className="k">지금 참여할 수 있는 축제</div><h2>진행 중인 축제를 둘러보세요</h2></div>
            <Link to="/festivals">전체 보기 <i className="ti ti-chevron-right" aria-hidden="true" /></Link>
          </div>
          {source === "loading" && (
            <div className="hm-fest">{[0, 1, 2, 3].map((i) => <div key={i} className="hm-skel"><div className="im" /><div className="l1" /><div className="l2" /></div>)}</div>
          )}
          {source !== "loading" && list.length > 0 && (
            <div className="hm-fest">
              {list.slice(0, 4).map((f, i) => (
                <Link key={f.id} to="/festivals" className={`reveal ${i ? `d${i}` : ""}`}>
                  <div className="im" style={{ backgroundImage: `url("${f.img}")` }}><b>{f.badge}</b></div>
                  <h4>{f.name}</h4>
                  <p>{[f.region, f.city].filter(Boolean).join(" ")} · {f.end.slice(0, 4)}.{mmdd(f.end)}까지</p>
                </Link>
              ))}
            </div>
          )}
          {source !== "loading" && list.length === 0 && (
            <div className="hm-empty">
              {source === "error" ? "축제를 불러오지 못했어요." : "지금 참여할 수 있는 축제가 없어요."} <Link to="/festivals">축제 탐색에서 보기</Link>
            </div>
          )}
          <div className="hm-src">축제 정보·사진 출처: 한국관광공사 TourAPI</div>
        </div>
      </section>

      <section className="hm-endwrap">
        <div className="hm-wrap">
          <div className="hm-end hm-photo reveal">
            <div><h2>이번 주말, 같이 갈 사람을 찾아볼까요?</h2><p>조건만 말하면 AI가 동행 후보를 찾아드려요.</p></div>
            <Link className="hm-btn primary" to="/matching">AI 동행 매칭 시작 <i className="ti ti-arrow-right" aria-hidden="true" /></Link>
          </div>
        </div>
      </section>
    </div>
  );
}
