// 축제 탐색 화면 데이터 — 실제 API 축제 목록 + 필터·월·상시 운영 분리 계산
import { useState } from "react";
import { calendarYear } from "../../../app/appState.js";
import { SOURCE_LABEL, useFestivals } from "./useFestivals.js";
import { isLong, matchesFilters, sourceText } from "../lib/festivalExplore.js";

export function useFestivalExplore(ui) {
  const { state, today, active, calMonth } = ui;
  const calendar = state.discoverView === "calendar";
  const { festivals, source } = useFestivals();
  const [fallbackText, sourceClass] = SOURCE_LABEL[source];
  const date = today();
  const currentYear = Number(date.slice(0, 4));
  const year = calendarYear(state, date);
  const availableYears = new Set([currentYear, year]);
  for (const f of festivals) {
    const firstYear = Number(f.start.slice(0, 4));
    const lastYear = Number(f.end.slice(0, 4));
    for (let festivalYear = firstYear; festivalYear <= lastYear; festivalYear += 1) {
      availableYears.add(festivalYear);
    }
  }
  const years = [...availableYears].sort((a, b) => a - b);
  const all = festivals.filter((f) => f.start <= `${year}-12-31` && f.end >= `${year}-01-01`);
  const available = all.filter(active).length;
  const past = all.length - available;
  const categories = [...new Set(all.map((f) => f.category))].sort();
  const regions = [...new Set(all.map((f) => f.region))].sort();
  const q = state.keyword.trim().toLowerCase();
  const byStart = (a, b) => a.start.localeCompare(b.start);
  const filtered = all.filter((f) => matchesFilters(f, state, active, q, year, state.month)).sort(byStart);
  // 캘린더형은 월 필터 대신 ‹ › 이동을 쓰므로 월 조건을 뺀 목록을 사용
  const calList = all.filter((f) => matchesFilters(f, state, active, q, year)).sort(byStart);
  const activeMonth = calendar ? calMonth() : state.month;
  const [showLong, setShowLong] = useState(true); // 상시·장기 운영 묶음, 기본은 펼친 상태
  const firstUpcomingMonth = year === currentYear ? Number(date.slice(5, 7)) : year < currentYear ? 13 : 1;
  const pastMonth = activeMonth && activeMonth < firstUpcomingMonth && state.status === "available";

  return {
    source, calendar, year, years, all, available, past, categories, regions, filtered, calList, activeMonth, firstUpcomingMonth, pastMonth,
    sourceText: sourceText(festivals, source, fallbackText), sourceClass,
    limited: filtered.filter((f) => !isLong(f)), longRun: filtered.filter(isLong),
    showLong, toggleLong: () => setShowLong((v) => !v),
  };
}
