// 축제 API 호출 모음 — 백엔드 응답(camelCase)을 기존 축제 화면이 쓰는 모양으로 바꿔 준다.
// 백엔드 기준: app/features/festivals/router.py, repository.py (_festival_view)
import { apiFetch } from "../../../shared/lib/apiClient.js";

const CATEGORY_EMOJI = { 미식: "🍜", 음악: "🎵", 문화: "🎨", 전통: "🏮", 자연: "🌿" };

// 백엔드 Festival → 화면 카드 모델 (기존 데모 데이터와 같은 필드명: start, end …)
export function toCardModel(f) {
  return {
    id: f.id,
    name: f.name,
    region: f.region,
    city: f.city || "",
    start: f.startDate,
    end: f.endDate,
    category: f.category,
    description: f.description || "",
    tags: f.tags || [],
    emoji: CATEGORY_EMOJI[f.category] || "🎪",
    riskStatus: f.riskStatus, // normal | weather_risk | changed | cancelled
    venue: f.venue, // { name, address, latitude, longitude }
    operatingHours: f.operatingHours || [], // [{ date, open, close, note }]
    apiStatus: f.status, // past | live | upcoming (서버가 오늘 날짜로 계산)
  };
}

// GET /festivals — 한 번에 최대 100건이라 끝까지 페이지를 넘기며 전부 모은다
export async function fetchAllFestivals(year = 2026) {
  const pageSize = 100;
  let page = 1;
  let items = [];
  let total = Infinity;
  while (items.length < total) {
    const data = await apiFetch(`/festivals?year=${year}&page=${page}&pageSize=${pageSize}`);
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
