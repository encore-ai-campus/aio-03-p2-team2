// 축제 탐색 — 실제 API 축제 목록(hooks/useFestivalExplore) + 화면 조각
// ExploreHero(배너·통계) · ExploreFilters(머리글·월·필터) · FilterSummary · FestivalSections(목록) | CalendarView · ExploreFlow(이용 흐름)
import { useAppState } from "../../../app/AppStateProvider.jsx";
import { ApiError, ApiLoading } from "../../../shared/components/ApiState.jsx";
import CalendarView from "../components/CalendarView.jsx";
import ExploreFilters from "../components/ExploreFilters.jsx";
import ExploreFlow from "../components/ExploreFlow.jsx";
import ExploreHero from "../components/ExploreHero.jsx";
import FestivalSections from "../components/FestivalSections.jsx";
import FilterSummary from "../components/FilterSummary.jsx";
import { useFestivalExplore } from "../hooks/useFestivalExplore.js";

export default function FestivalExplorePage() {
  const ui = useAppState();
  const x = useFestivalExplore(ui);
  // 실제 조회 상태에 따라 로딩·오류를 안내한다.
  if (x.source === "loading") return <ApiLoading text="축제 불러오는 중…" />;
  if (x.source === "error") return <ApiError />;
  return (
    <>
      <ExploreHero btn={ui.btn} total={x.all.length} available={x.available} past={x.past} />
      <ExploreFilters ui={ui} x={x} />
      <FilterSummary ui={ui} />
      <div
        style={{
          height: "15px",
        }}
      />
      {x.calendar ? <CalendarView ui={ui} list={x.calList} /> : <FestivalSections ui={ui} x={x} />}
      <ExploreFlow />
    </>
  );
}
