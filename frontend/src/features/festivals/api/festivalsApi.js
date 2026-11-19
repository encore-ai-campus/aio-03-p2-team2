// 축제 API 호출 모음 — 백엔드 응답(camelCase)을 기존 축제 화면이 쓰는 모양으로 바꿔 준다.
// 백엔드 기준: app/features/festivals/router.py, repository.py (_festival_view)
import { apiFetch } from "../../../shared/lib/apiClient.js";

const CATEGORY_EMOJI = { 미식: "🍜", 음악: "🎵", 문화: "🎨", 전통: "🏮", 자연: "🌿" };
// TourAPI 수집 데이터는 분류가 영문(festival 등)으로 와서 화면용 한글로 바꾼다
const CATEGORY_KO = { festival: "축제", event: "행사", performance: "공연", exhibition: "전시", culture: "문화", tradition: "전통", food: "미식", music: "음악", nature: "자연" };
export const categoryKo = (c) => (c ? CATEGORY_KO[String(c).toLowerCase()] || c : "축제");

// 백엔드 Festival → 화면 카드 모델 (기존 데모 데이터와 같은 필드명: start, end …)
export function toCardModel(f) {
  return {
    id: f.id,
    name: f.name,
    region: f.region,
    city: f.city || "",
    start: f.startDate,
    end: f.endDate,
    category: categoryKo(f.category),
    description: f.description || "",
    tags: f.tags || [],
    emoji: CATEGORY_EMOJI[f.category] || "🎪",
    imageUrl: f.imageUrl || null, // TourAPI 대표 이미지 (없으면 null → 화면은 이모지)
    thumbnailUrl: f.thumbnailUrl || null,
    riskStatus: f.riskStatus, // normal | weather_risk | changed | cancelled
    venue: f.venue, // { name, address, latitude, longitude }
    operatingHours: f.operatingHours || [], // [{ date, open, close, note }]
    apiStatus: f.status, // past | live | upcoming (서버가 오늘 날짜로 계산)
    source: f.source, // official_api(한국관광공사 TourAPI) | manual
    sourceUpdatedAt: f.sourceUpdatedAt || null,
  };
}

// GET /festivals — 한 번에 최대 100건이라 끝까지 페이지를 넘기며 전부 모은다
export async function fetchAllFestivals(year) {
  const pageSize = 100;
  let page = 1;
  let items = [];
  let total = Infinity;
  while (items.length < total) {
    const query = new URLSearchParams({ page, pageSize });
    if (year !== undefined) query.set("year", year);
    const data = await apiFetch(`/festivals?${query}`);
    items = items.concat(data.items);
    total = data.total;
    if (!data.items.length) break;
    page += 1;
  }
  return items.map(toCardModel);
}

// GET /festivals/{id} — 상세 (운영시간·장소 포함)
export const fetchFestival = (id) => apiFetch(`/festivals/${encodeURIComponent(id)}`).then(toCardModel);

// GET /festivals/calendar — { year, month, events: [{ date, festivalId, name, category, status }] }
export const fetchCalendar = (year, month) => apiFetch(`/festivals/calendar?year=${year}&month=${month}`);
