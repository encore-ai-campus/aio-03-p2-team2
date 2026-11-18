// 축제 탐색 상단: 소개 배너 + 올해·참여 가능·지난 축제 수
export default function ExploreHero({ btn, total, available, past }) {
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
            <strong>{total}</strong>
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
      </div>
    </>
  );
}
