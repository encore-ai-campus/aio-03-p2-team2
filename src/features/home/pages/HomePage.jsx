// 홈(공개) — 서비스 소개 → 이용 절차 4단계 → AI 기능 → 진행 중 축제 → 마무리 띠
// 목업 public/mockup/home.html(v3) 확정본 기준. 로그인 없이 볼 수 있다.
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useReveal } from "../../../shared/hooks/useReveal.js";
import HomeScreens from "../components/HomeScreens.jsx";
import { useActiveStep } from "../hooks/useActiveStep.js";
import { usePreviewFestivals } from "../hooks/usePreviewFestivals.js";
import { FEATURES, STEPS, mmdd } from "../lib/homeContent.js";
import "../home.css";

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
            <HomeScreens step={step} festivals={list} />
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
