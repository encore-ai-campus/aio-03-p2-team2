// 홈 — 이용 절차 4단계·AI 기능 문구, 날짜 표시 함수

export const STEPS = [
  {
    no: 1, tag: "축제 고르기", title: ["가고 싶은 축제를", "먼저 골라요"],
    desc: "축제명·지역·유형으로 참여할 수 있는 축제를 찾고, 달력으로 월별 일정도 확인해요.",
    points: ["한국관광공사 축제 정보", "목록·달력 보기"], link: ["/festivals", "축제 탐색하기"],
  },
  {
    no: 2, tag: "AI 동행 매칭", title: ["원하는 동행을", "말로 설명해요"],
    desc: "날짜·시간·인원·분위기를 대화로 알려주면 AI가 조건을 정리하고, 잘 맞는 후보를 일치 점수와 함께 추천해요.",
    points: ["대화에서 조건 자동 정리", "함께할 동행을 직접 선택"], link: ["/matching", "매칭 시작하기"],
  },
  {
    no: 3, tag: "모임 참여·채팅", title: ["모임에 참여하고", "함께 이야기해요"],
    desc: "모집글에 참여를 신청하고, 모임장이 승인하면 채팅방에서 만날 장소와 시간을 정해요.",
    points: ["모임장 승인 후 입장", "정원이 차면 자동 마감"], link: ["/groups", "커뮤니티 보기"],
  },
  {
    no: 4, tag: "일정·날씨 확인", title: ["비가 오면", "AI가 먼저 알려줘요"],
    desc: "모임 시간의 실제 예보를 확인해 비 소식이 있으면 진행 여부를 묻고, 대체 축제나 새 일정을 제안해요.",
    points: ["시간별 강수확률 확인", "대체 축제·새 일정 제안"], link: ["/alerts", "AI 알림 보기"],
  },
];

export const FEATURES = [
  { icon: "ti-message-chatbot", title: "대화로 조건 정리", desc: "문장 속 날짜·시간·인원·분위기를 매칭 조건으로 바꿔요. 빠진 조건은 하나씩 다시 물어봐요.", ex: ["예시", "“토요일 저녁, 조용히 즐길 2명”"] },
  { icon: "ti-users-group", title: "일치 점수로 추천", desc: "관심사·연령대·여행 스타일을 비교해 점수가 높은 후보부터 보여주고, 겹치는 조건을 표시해요.", ex: ["기준", "일치 점수 60점 이상만 추천"] },
  { icon: "ti-cloud-rain", title: "날씨 대응", desc: "모임 시간의 실제 예보를 확인하고, 비가 오면 진행 여부를 묻고 대체 축제를 찾아줘요.", ex: ["데이터", "Open-Meteo 시간별 예보"] },
];

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const mmdd = (v) => (v || "").slice(5).replace("-", ".");
export const badge = (f, today) => {
  if (f.start <= today) return "진행 중";
  const days = Math.round((new Date(`${f.start}T00:00:00`) - new Date(`${today}T00:00:00`)) / 864e5);
  return `D-${days}`;
};
