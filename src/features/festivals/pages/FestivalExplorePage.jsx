// 축제 탐색 — 실제 API 축제 목록(hooks/useFestivalExplore) + 화면 조각
// ExploreHero(서비스 소개 배너) · ExploreFilters(머리글·월·필터) · FilterSummary · FestivalSections(목록) | CalendarView · ExploreFlow(이용 흐름)
import { useEffect, useRef, useState } from "react";
import { useAppState } from "../../../app/AppStateProvider.jsx";
import { ApiError, ApiLoading } from "../../../shared/components/ApiState.jsx";
import CalendarView from "../components/CalendarView.jsx";
import ExploreFilters from "../components/ExploreFilters.jsx";
import ExploreFlow from "../components/ExploreFlow.jsx";
import ExploreHero from "../components/ExploreHero.jsx";
import FestivalSections from "../components/FestivalSections.jsx";
import FilterSummary from "../components/FilterSummary.jsx";
import { useFestivalExplore } from "../hooks/useFestivalExplore.js";

import "../explore.css";

export default function FestivalExplorePage() {
  const ui = useAppState();
  const x = useFestivalExplore(ui);
  const exploreRef = useRef(null);
  const resultsRef = useRef(null);
  const [scrollTarget, setScrollTarget] = useState(null);

  useEffect(() => {
    if (!scrollTarget || (scrollTarget === "calendar" && !x.calendar)) return undefined;
    // 보기 전환이 DOM에 반영된 다음 이동한다. 필터 값은 그대로 유지한다.
    const frame = requestAnimationFrame(() => {
      const target = scrollTarget === "calendar" ? resultsRef.current : exploreRef.current;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" });
      setScrollTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollTarget, x.calendar]);
  // 실제 조회 상태에 따라 로딩·오류를 안내한다.
  if (x.source === "loading") return <ApiLoading text="축제 불러오는 중…" />;
  if (x.source === "error") return <ApiError />;
  return (
    <>
      <ExploreHero btn={ui.btn} onExplore={() => setScrollTarget("explore")} onCalendar={() => {
        ui.dispatch("view:calendar");
        setScrollTarget("calendar");
      }} />
      <div id="fx-hero-explore" className="fx-hero-target" ref={exploreRef} tabIndex={-1} role="region" aria-label="축제 탐색 조건">
        <ExploreFilters ui={ui} x={x} />
      </div>
      <FilterSummary ui={ui} />
      <div
        style={{
          height: "15px",
        }}
      />
      <div id="fx-hero-results" className="fx-hero-target" ref={resultsRef} tabIndex={-1} role="region" aria-label={x.calendar ? "축제 캘린더" : "축제 검색 결과"}>
        {x.calendar ? <CalendarView ui={ui} list={x.calList} /> : <FestivalSections ui={ui} x={x} />}
      </div>
      <ExploreFlow />
    </>
  );
}
