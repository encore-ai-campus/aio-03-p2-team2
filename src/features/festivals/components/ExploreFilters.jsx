// 축제 둘러보기 머리글(출처·결과 수·보기 전환) + 월 버튼 + 검색·상태·지역·유형 필터
import { Fragment } from "react";
import { ViewToggle } from "./CalendarView.jsx";

const MONTHS = [0, ...Array.from({ length: 12 }, (_, i) => i + 1)];

export default function ExploreFilters({ ui, x }) {
  const { btn, fieldProps, today } = ui;
  return (
    <>
      <div className="section-head">
        <div>
          <h2>2026 축제 둘러보기</h2>
          <p>
            {"1월~12월 · 참여 가능 여부 자동 표시 · 오늘 "}
            {today()}
          </p>
        </div>
        <div className="section-actions">
          <span className={x.sourceClass} title="축제 데이터 출처">{x.sourceText}</span>
          {!x.calendar && (
            <span className="pill blue">
              {"검색 결과 "}
              {x.filtered.length}건
            </span>
          )}
          <ViewToggle ui={ui} />
        </div>
      </div>

      <div className="months">
        {MONTHS.map((m, index) => (
          <Fragment key={index}>
            {btn(
              m ? m + "월" : "전체",
              `month:${m}`,
              `month-button ${m === x.activeMonth ? "active" : ""} ${m && m < x.curMonth ? "is-past" : ""}`,
            )}
          </Fragment>
        ))}
      </div>

      <div
        className="months"
        style={{
          display: "none",
        }}
      />

      <div className="filter-grid">
        <input
          id="filter-keyword"
          className="searchbox"
          placeholder="축제명·지역·태그 검색"
          aria-label="축제 검색어"
          {...fieldProps("filter-keyword")}
        />
        <select id="filter-status" aria-label="기간 상태" {...fieldProps("filter-status")}>
          <option value="all">전체 (지난 축제 포함)</option>
          <option value="available">참여 가능</option>
          <option value="past">기간 종료</option>
        </select>
        <select id="filter-region" aria-label="지역" {...fieldProps("filter-region")}>
          <option value="all">전국 지역</option>
          {x.regions.map((r, index) => (
            <Fragment key={index}>
              <option>{r}</option>
            </Fragment>
          ))}
        </select>
        <select id="filter-category" aria-label="축제 유형" {...fieldProps("filter-category")}>
          <option value="all">전체 유형</option>
          {x.categories.map((c, index) => (
            <Fragment key={index}>
              <option>{c}</option>
            </Fragment>
          ))}
        </select>
      </div>
    </>
  );
}
