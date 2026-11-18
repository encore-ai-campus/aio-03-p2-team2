// v4.1 · AI 매칭 도우미 (자연어 → 매칭 조건 슬롯)
// 데모는 규칙 기반 파서다. 실서비스에서는 aiParse()를 백엔드
// POST /matching/sessions/{id}/messages 호출(LLM Function Calling:
// extract_match_conditions)로 교체한다.

export const AI_EXAMPLES = [
  "부산 음악축제 오후 3시부터 가능해요. 예산 10만원, 공연이랑 사진 좋아하고 여유롭게 4명이서 가고 싶어요",
  "전주 미식축제에서 맛집 투어할 동행 구해요! 11시부터, 8만원 정도, ENFP나 INFJ면 좋겠어요",
  "12월 5일 강릉 가요. 전시랑 산책 위주로 계획적으로 다닐 3명, 모임장 승인제로 해주세요",
];
export const AI_EXAMPLE_LABELS = ["부산 음악축제", "전주 미식축제", "12월 강릉"];
export const AI_PLACEHOLDERS = [
  "예) 부산 음악축제, 3시부터, 10만원",
  "예) 전주 미식축제 맛집 투어, 8만원",
  "예) 12월 5일 강릉, 전시·산책 3명",
  "예) 예산 15만원으로 바꿔줘",
  "예) MBTI는 상관없어요, 바로 참여 가능하게",
];
export const AI_INTEREST = {
  미식: ["미식", "맛집", "먹방", "먹거리", "음식", "먹", "시장", "푸드"],
  사진: ["사진", "인생샷", "포토", "찍", "출사"],
  산책: ["산책", "걷", "골목", "도보"],
  음악: ["음악", "공연", "밴드", "재즈", "콘서트", "버스킹"],
  문화: ["문화", "전시", "예술", "미술", "갤러리"],
  전통: ["전통", "한옥", "역사", "고궁"],
  자연: ["자연", "바다", "해변", "바닷가", "꽃", "숲"],
  카페: ["카페", "커피", "디저트", "빵"],
  액티비티: ["액티비티", "체험", "레저"],
};
export const AI_STYLE = {
  여유롭게: ["여유", "느긋", "천천히", "힐링", "쉬엄"],
  활동적으로: ["활동적", "액티브", "에너지", "빡세", "부지런", "많이 돌"],
  계획적으로: ["계획", "꼼꼼", "시간표", "일정대로", "J형"],
};
export const AI_JOIN = { approval: "모임장 승인제", instant: "즉시 참여제" };
export const AI_BUDGETS = [3, 5, 7, 8, 10, 12, 15, 20];
export const AI_LABEL = {
  start: (v) => `시작 ${v}`,
  budget: (v) => `예산 ${v}만원`,
  party: (v) => `인원 ${v}명`,
  interests: (v) => `관심사 ${v.join("·")}`,
  style: (v) => `스타일 ‘${v}’`,
  mbti: (v) => (v.length ? `MBTI ${v.join("/")}` : "MBTI 무관"),
  joinMode: (v) => AI_JOIN[v],
};

const hhmm = (m) =>
  String(Math.floor(m / 60)).padStart(2, "0") +
  ":" +
  String(m % 60).padStart(2, "0");

export function aiTime(t) {
  let m = t.match(/(\d{1,2}):(\d{2})/);
  if (m && +m[1] < 24 && +m[2] < 60) return hhmm(+m[1] * 60 + +m[2]);
  m = t.match(
    /(새벽|아침|오전|낮|점심|오후|저녁|밤)?\s*(\d{1,2})\s*시(?!간)\s*(반|(\d{1,2})\s*분)?/,
  );
  if (m) {
    let h = +m[2];
    const mi = m[3] === "반" ? 30 : m[4] ? +m[4] : 0;
    const q = m[1] || "";
    if (h > 24 || mi > 59) return null;
    if (["오후", "저녁", "밤"].includes(q) && h < 12) h += 12;
    else if ((q === "낮" || q === "점심") && h < 6) h += 12;
    else if (!q && h >= 1 && h <= 7) h += 12;
    if (h === 24) h = 0;
    return hhmm(h * 60 + mi);
  }
  m = t.match(/(아침|오전|점심|오후|저녁)\s*(부터|쯤|이후|에\s*(만나|출발|시작))/);
  if (m)
    return {
      아침: "10:00",
      오전: "10:00",
      점심: "12:00",
      오후: "13:00",
      저녁: "17:00",
    }[m[1]];
  return null;
}

export function aiBudget(t) {
  let v = null;
  let m = t.match(/(\d{1,3})\s*만\s*원?/);
  if (m) v = +m[1];
  else if ((m = t.match(/(\d{1,3}(?:,\d{3})+|\d{5,7})\s*원/)))
    v = Math.round(+m[1].replace(/,/g, "") / 10000);
  else if (/저렴|가성비|아껴|적게\s*쓰/.test(t)) v = 5;
  if (!v) return null;
  return AI_BUDGETS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}

export function aiParty(t) {
  const W = { 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8 };
  let m =
    t.match(/(둘|셋|넷|다섯|여섯|일곱|여덟)이서/) ||
    t.match(/(두|세|네|다섯|여섯|일곱|여덟)\s*명/);
  let v = m ? W[m[1]] : null;
  if (!v) {
    m = t.match(/(\d{1,2})\s*명/) || t.match(/(\d{1,2})\s*인(?![당분])/);
    if (m) v = +m[1];
  }
  return v ? Math.max(2, Math.min(8, v)) : null;
}

// ctx: { festivals, active(f), today() }
export function aiFestival(t, ctx) {
  const list = ctx.festivals.filter(ctx.active);
  const VOCAB = new Set([...Object.keys(AI_INTEREST), "봄", "여름", "가을", "겨울"]);
  const md = t.match(/(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?/);
  const mon = md ? +md[1] : null;
  const day = md && md[2] ? +md[2] : null;
  const now = new Date(ctx.today() + "T00:00:00");
  const near = (f, a, b) => {
    const s = (new Date(f.start + "T00:00:00") - now) / 864e5;
    const e = (new Date(f.end + "T00:00:00") - now) / 864e5;
    return e >= a && s <= b;
  };
  const scored = list
    .map((f) => {
      let s = 0;
      if (f.city && t.includes(f.city)) s += 3;
      else if (f.region && t.includes(f.region)) s += 2;
      f.name
        .split(" ")
        .map((w) => w.replace(/(축제|페스티벌|주간|마켓|여행|산책|한마당|페어|문화제)$/, ""))
        .filter((w) => w.length >= 2 && w !== f.city && w !== f.region && !VOCAB.has(w))
        .forEach((w) => {
          if (t.includes(w)) s += 2;
        });
      if (new RegExp(f.category + "\\s*(축제|마켓|페스티벌)").test(t)) s += 2;
      if (mon) {
        const ym = `2026-${String(mon).padStart(2, "0")}`;
        if (day) {
          const dt = `${ym}-${String(day).padStart(2, "0")}`;
          if (f.start <= dt && f.end >= dt) s += 3;
        } else if (f.start.slice(0, 7) <= ym && f.end.slice(0, 7) >= ym) s += 1;
      }
      if (/이번\s*주/.test(t) && near(f, 0, 7)) s += 1;
      if (/다음\s*주/.test(t) && near(f, 7, 14)) s += 1;
      return { id: f.id, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return { id: null, options: [] };
  const top = scored[0].s;
  const tied = scored.filter((x) => x.s === top);
  if (top >= 3 && tied.length === 1) return { id: scored[0].id, options: [] };
  return {
    id: null,
    options: (tied.length > 1 ? tied : scored).slice(0, 4).map((x) => x.id),
  };
}

export function aiParse(text, ctx) {
  const t = String(text).replace(/\s+/g, " ").trim();
  const slots = {};
  const time = aiTime(t);
  if (time) slots.start = time;
  const budget = aiBudget(t);
  if (budget) slots.budget = budget;
  const party = aiParty(t);
  if (party) slots.party = party;
  const interests = Object.entries(AI_INTEREST)
    .filter(([, ws]) => ws.some((w) => t.includes(w)))
    .map(([k]) => k);
  if (interests.length) slots.interests = interests;
  const style = Object.entries(AI_STYLE)
    .map(([k, ws]) => [k, ws.filter((w) => t.includes(w)).length])
    .sort((a, b) => b[1] - a[1])[0];
  if (style[1]) slots.style = style[0];
  if (/(MBTI|엠비티아이)\s*(는|은)?\s*(상관\s*없|무관|안\s*봐|노상관|아무)/i.test(t))
    slots.mbti = [];
  else {
    const ms = [...t.matchAll(/(?<![A-Za-z])([EI][NS][TF][JP])(?![A-Za-z])/gi)].map((x) =>
      x[1].toUpperCase(),
    );
    if (ms.length) slots.mbti = [...new Set(ms)];
  }
  if (/승인\s*(없이|없는|안\s*받|필요\s*없)|(즉시|바로)\s*(참여|입장)|누구나|아무나\s*(들어|참여)/.test(t))
    slots.joinMode = "instant";
  else if (/승인/.test(t)) slots.joinMode = "approval";
  return { text: t, slots, fest: aiFestival(t, ctx) };
}

// 실서비스 LLM Function Calling 인자 형식 (API 명세 SessionView.conditions와 동일)
export const aiArgs = (d) => ({
  festival_id: d.festivalId ?? null,
  start_time: d.start ?? null,
  budget_manwon: d.budget ?? null,
  interests: d.interests ?? null,
  travel_style: d.style ?? null,
  preferred_mbti: d.mbti ?? null,
  party_size: d.party ?? null,
  join_mode: d.joinMode ?? null,
});
