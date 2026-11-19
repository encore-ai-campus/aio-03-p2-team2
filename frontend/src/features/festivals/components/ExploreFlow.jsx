// 축제 탐색 하단: 페스로움 이용 흐름 4단계
const STEPS = [
  ["축제 탐색", "축제 기간과 참여 가능 여부 확인"],
  ["AI 동행 매칭", "여행 선호로 매칭 점수와 동행 후보 추천"],
  ["커뮤니티 자동 게시", "모임방·공개글 생성, 댓글 후 참여 신청"],
  ["공동 일정·채팅", "정원 검증, 모임장 승인, 변경 알림"],
];

export default function ExploreFlow() {
  return (
    <>
      <div className="section-head">
        <h2>페스로움 이용 흐름</h2>
      </div>
      <div className="how">
        {STEPS.map(([title, desc], i) => (
          <div className="box" key={title}>
            <b>{`STEP 0${i + 1}`}</b>
            <strong>{title}</strong>
            <p>{desc}</p>
          </div>
        ))}
      </div>
    </>
  );
}
