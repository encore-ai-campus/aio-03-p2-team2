import { Fragment } from "react";
import { useDemo } from "../../../app/DemoProvider.jsx";
import CalendarView, { ViewToggle } from "../components/CalendarView.jsx";
import { SOURCE_LABEL, useFestivals } from "../hooks/useFestivals.js";
import { DEMO_MODE } from "../../../shared/lib/demoMode.js";
import { ApiError, ApiLoading } from "../../../shared/components/ApiState.jsx";
export default function FestivalExplorePage() {
  const demo = useDemo();
  const { state, btn, fieldProps, today, active, groupClosed, fCard, calMonth } = demo;
  const calendar = state.discoverView === "calendar";
  // 실제 API 축제 목록 (실패하면 데모 데이터 그대로)
  const { festivals, source } = useFestivals(state.festivals);
  const [sourceText, sourceClass] = SOURCE_LABEL[source];
  const all = festivals.filter(
    (f) => f.start <= "2026-12-31" && f.end >= "2026-01-01",
  );
  const available = all.filter(active).length,
    past = all.length - available;
  const categories = [...new Set(all.map((f) => f.category))].sort(),
    regions = [...new Set(all.map((f) => f.region))].sort();
  const q = state.keyword.trim().toLowerCase();
  let filtered = all
    .filter(
      (f) =>
        (!state.month ||
          (f.start.slice(0, 7) <=
            `2026-${String(state.month).padStart(2, "0")}` &&
            f.end.slice(0, 7) >=
              `2026-${String(state.month).padStart(2, "0")}`)) &&
        (state.status === "all" ||
          (state.status === "available" && active(f)) ||
          (state.status === "past" && !active(f))) &&
        (state.region === "all" || f.region === state.region) &&
        (state.category === "all" || f.category === state.category) &&
        (!q ||
          `${f.name} ${f.region} ${f.city} ${f.description} ${(f.tags || []).join(" ")}`
            .toLowerCase()
            .includes(q)),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  // 캘린더형은 월 필터 대신 ‹ › 이동을 쓰므로 월 조건을 뺀 목록을 사용
  const calList = all
    .filter(
      (f) =>
        (state.status === "all" ||
          (state.status === "available" && active(f)) ||
          (state.status === "past" && !active(f))) &&
        (state.region === "all" || f.region === state.region) &&
        (state.category === "all" || f.category === state.category) &&
        (!q ||
          `${f.name} ${f.region} ${f.city} ${f.description} ${(f.tags || []).join(" ")}`
            .toLowerCase()
            .includes(q)),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const activeMonth = calendar ? calMonth() : state.month;
  // 데모 모드가 아니면: 불러오는 중엔 스켈레톤, 연결 실패면 안내 (예시 축제로 바꾸지 않음)
  if (!DEMO_MODE && source === "loading") return <ApiLoading text="축제 불러오는 중…" />;
  if (!DEMO_MODE && source === "demo") return <ApiError />;
  return (
    <>
      <section className="hero">
        <div>
          <span className="pill white">✨ 2026 FESTIVAL COLLECTION</span>
          <h1>
            2026 전국 지역축제,
            <br />
            모든 계절을 함께 발견해요
          </h1>
          <p>
            지난 축제는 기록으로, 예정된 축제는 동행 매칭으로. 축제 선택부터
            모임 운영까지 이어져요.
          </p>
          <div className="btnrow hero-cta">
            {btn("AI 동행 매칭 시작하기", "nav:match", "btn hero-primary")}
            {btn("참여 가능한 축제 보기", "status:available", "btn hero-ghost")}
          </div>
        </div>
        <div className="hero-art">🎪</div>
      </section>

      <div className="stats">
        <div className="stat">
          <div className="icon">🗓️</div>
          <div>
            <strong>{all.length}</strong>
            <span>올해 축제</span>
          </div>
        </div>
        <div className="stat">
          <div className="icon">✅</div>
          <div>
            <strong>{available}</strong>
            <span>지금 참여 가능</span>
          </div>
        </div>
        <div className="stat">
          <div className="icon">🕘</div>
          <div>
            <strong>{past}</strong>
            <span>지난 축제</span>
          </div>
        </div>
        <div className="stat">
          <div className="icon">👥</div>
          <div>
            <strong>
              {state.groups.filter((g) => !groupClosed(g)).length}
            </strong>
            <span>모집 중인 동행 모임</span>
          </div>
        </div>
      </div>

      <div className="section-head">
        <div>
          <h2>2026 축제 둘러보기</h2>
          <p>
            {"1월~12월 · 참여 가능 여부 자동 표시 · 오늘 "}
            {today()}
          </p>
        </div>
        <div className="section-actions">
          <span className={sourceClass} title="축제 데이터 출처">{sourceText}</span>
          {!calendar && (
            <span className="pill blue">
              {"검색 결과 "}
              {filtered.length}건
            </span>
          )}
          <ViewToggle demo={demo} />
        </div>
      </div>

      <div className="months">
        {[
          0,
          ...Array.from(
            {
              length: 12,
            },
            (_, i) => i + 1,
          ),
        ].map((m, index) => (
          <Fragment key={index}>
            {btn(
              m ? m + "월" : "전체",
              `month:${m}`,
              `month-button ${m === activeMonth ? "active" : ""}`,
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
          placeholder="🔎 축제명·지역·태그 검색"
          aria-label="축제 검색어"
          {...fieldProps("filter-keyword")}
        />
        <select
          id="filter-status"
          aria-label="기간 상태"
          {...fieldProps("filter-status")}
        >
          <option value="all">전체 상태</option>
          <option value="available">참여 가능</option>
          <option value="past">기간 종료</option>
        </select>
        <select
          id="filter-region"
          aria-label="지역"
          {...fieldProps("filter-region")}
        >
          <option value="all">전국 지역</option>
          {regions.map((x, index) => (
            <Fragment key={index}>
              <option>{x}</option>
            </Fragment>
          ))}
        </select>
        <select
          id="filter-category"
          aria-label="축제 유형"
          {...fieldProps("filter-category")}
        >
          <option value="all">전체 유형</option>
          {categories.map((x, index) => (
            <Fragment key={index}>
              <option>{x}</option>
            </Fragment>
          ))}
        </select>
      </div>

      <FilterSummary demo={demo} />
      <div
        style={{
          height: "15px",
        }}
      />
      {calendar ? (
        <CalendarView demo={demo} list={calList} />
      ) : filtered.length ? (
        <>
          <div className="festival-grid">
            {filtered.map((item, index) => (
              <Fragment key={index}>{fCard(item)}</Fragment>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="empty">
            <div className="big">🔎</div>
            <h3>조건에 맞는 축제가 없어요</h3>
            <p>다른 달 또는 다른 지역을 선택해 보세요.</p>
          </div>
        </>
      )}

      <div className="section-head">
        <h2>페스타메이트 이용 흐름</h2>
      </div>
      <div className="how">
        <div className="box">
          <b>STEP 01</b>
          <strong>축제 탐색</strong>
          <p>2026 전체 기간과 참여 가능 여부 확인</p>
        </div>
        <div className="box">
          <b>STEP 02</b>
          <strong>AI 동행 매칭</strong>
          <p>여행 선호로 매칭 점수와 동행 후보 추천</p>
        </div>
        <div className="box">
          <b>STEP 03</b>
          <strong>커뮤니티 자동 게시</strong>
          <p>모임방·공개글 생성, 댓글 후 참여 신청</p>
        </div>
        <div className="box">
          <b>STEP 04</b>
          <strong>공동 일정·채팅</strong>
          <p>정원 검증, 모임장 승인, 변경 알림</p>
        </div>
      </div>
    </>
  );
}

// v4.3 · 적용 중인 필터 요약과 개별·전체 초기화
function FilterSummary({ demo }) {
  const { state, dispatch } = demo;
  const items = [];
  if (state.discoverView !== "calendar" && state.month) items.push(["month", state.month + "월"]);
  if (state.status !== "all")
    items.push(["status", state.status === "available" ? "참여 가능" : "기간 종료"]);
  if (state.region !== "all") items.push(["region", state.region]);
  if (state.category !== "all") items.push(["category", state.category]);
  if (state.keyword.trim()) items.push(["keyword", `“${state.keyword.trim()}”`]);
  if (!items.length) return null;
  return (
    <div className="filter-summary">
      <span>적용 중</span>
      {items.map(([k, l]) => (
        <button
          key={k}
          type="button"
          className="fchip"
          aria-label={`${l} 필터 해제`}
          onClick={() => dispatch(`clearFilter:${k}`)}
        >
          {l} ✕
        </button>
      ))}
      <button type="button" className="btn text" onClick={() => dispatch("clearFilters")}>
        필터 초기화
      </button>
    </div>
  );
}
