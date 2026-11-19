// 온보딩·마이페이지가 같이 쓰는 선택지와 변환 규칙 (백엔드 ProfilePatch / DB user_profiles 기준)

export const INTERESTS = [
  { value: "음악", emoji: "🎵" },
  { value: "미식", emoji: "🍜" },
  { value: "사진", emoji: "📸" },
  { value: "문화", emoji: "🎨" },
  { value: "카페", emoji: "☕" },
  { value: "산책", emoji: "🚶" },
  { value: "전통", emoji: "🏮" },
];

export const STYLES = [
  { value: "여유롭게", emoji: "🌿", desc: "천천히 둘러보며 쉬엄쉬엄" },
  { value: "활동적으로", emoji: "⚡", desc: "공연·체험으로 꽉 채워서" },
  { value: "계획적으로", emoji: "📋", desc: "동선과 시간을 미리 짜서" },
];

// 성별·연령대 — DB user_profiles CHECK와 같은 한글 값 (백엔드 ProfilePatch gender / ageBand)
export const GENDERS = [
  { value: "여성", emoji: "👩" },
  { value: "남성", emoji: "👨" },
];
export const AGE_BANDS = ["10대", "20대", "30대", "40대", "50대"];

export const BUDGETS = [3, 5, 7, 10, 15]; // 만원
export const PARTY_SIZES = [2, 3, 4, 5, 6, 7, 8]; // 모임 정원 상한 8

export const TIMES = [
  { value: "10:00", emoji: "🌅", label: "오전" },
  { value: "12:00", emoji: "☀️", label: "점심" },
  { value: "15:00", emoji: "🌇", label: "오후" },
  { value: "18:00", emoji: "🌙", label: "저녁" },
];

export const JOIN_MODES = [
  { value: "approval", emoji: "✋", label: "승인 후 참여", desc: "신청을 보고 내가 수락해요" },
  { value: "instant", emoji: "🚀", label: "바로 참여", desc: "누구나 바로 합류할 수 있어요" },
];

export const MBTIS = [
  "ISTJ", "ISFJ", "INFJ", "INTJ", "ISTP", "ISFP", "INFP", "INTP",
  "ESTP", "ESFP", "ENFP", "ENTP", "ESTJ", "ESFJ", "ENFJ", "ENTJ",
];

// 화면 입력값의 시작 상태 (전부 비어 있음 = 선택 안 함)
export const EMPTY_FORM = {
  gender: "",
  ageBand: "",
  interests: [],
  budgetManwon: "",
  travelStyle: "",
  mbti: "",
  preferredPartySize: "",
  availableFrom: "",
  defaultJoinMode: "approval",
};

// 화면 입력값 → PATCH /me/profile 요청 본문 (비운 항목은 보내지 않음)
export function toProfileBody(form) {
  const body = { defaultJoinMode: form.defaultJoinMode };
  if (form.gender) body.gender = form.gender;
  if (form.ageBand) body.ageBand = form.ageBand;
  if (form.interests.length) body.interests = form.interests;
  if (form.budgetManwon) body.budgetManwon = Number(form.budgetManwon);
  if (form.travelStyle) body.travelStyle = form.travelStyle;
  if (form.mbti) body.mbti = [form.mbti];
  if (form.preferredPartySize) body.preferredPartySize = Number(form.preferredPartySize);
  if (form.availableFrom) body.availableFrom = form.availableFrom.slice(0, 5); // "HH:mm"
  return body;
}

// GET /me 응답의 profile → 화면 입력값 (마이페이지에서 기존 값 채우기)
export function fromProfile(profile = {}) {
  return {
    gender: profile.gender ?? "",
    ageBand: profile.ageBand ?? "",
    interests: profile.interests ?? [],
    budgetManwon: profile.budgetManwon ?? "",
    travelStyle: profile.travelStyle ?? "",
    mbti: profile.mbti?.[0] ?? "",
    preferredPartySize: profile.preferredPartySize ?? "",
    availableFrom: profile.availableFrom ? String(profile.availableFrom).slice(0, 5) : "",
    defaultJoinMode: profile.defaultJoinMode ?? "approval",
  };
}

export function toggleInList(list, value) {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}
