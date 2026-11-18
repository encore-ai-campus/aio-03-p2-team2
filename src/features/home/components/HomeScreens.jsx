// 홈 「이용 방법」 오른쪽 고정 무대 — 실제 화면 구성을 그대로 줄인 미니 화면 4개
import { mmdd } from "../lib/homeContent.js";

function MiniNav({ current }) {
  return (
    <div className="hm-mnav">
      <img src="/brand/fesroam_logo_horizontal.png" alt="" />
      {["축제 탐색", "AI 동행 매칭", "커뮤니티", "내 모임"].map((m) => (
        m === current ? <b key={m}>{m}</b> : <span key={m}>{m}</span>
      ))}
    </div>
  );
}
function Bar({ path }) {
  return (
    <div className="hm-bar">
      <i /><i /><i /><span>fesroam / {path}</span>
    </div>
  );
}

// 오른쪽 고정 무대의 미니 화면 4개 — 실제 화면 구성을 그대로 줄인 것
export default function Screens({ step, festivals }) {
  const six = festivals.length ? festivals : Array.from({ length: 6 }, (_, i) => ({ id: `ph${i}` }));
  return (
    <div className="hm-stage" aria-hidden="true">
      <div className={`hm-screen ${step === 0 ? "on" : ""}`}>
        <Bar path="축제 탐색" />
        <MiniNav current="축제 탐색" />
        <div className="hm-mbody">
          <div className="hm-mh"><div><b>축제 탐색</b><span>참여할 수 있는 축제를 찾아보세요</span></div><span>한국관광공사 TourAPI</span></div>
          <div className="hm-fbar">
            <div className="hm-inp"><i className="ti ti-search" />축제명·지역·태그 검색</div>
            <div className="hm-sel">참여 가능<i className="ti ti-chevron-down" /></div>
            <div className="hm-sel">전국 지역<i className="ti ti-chevron-down" /></div>
            <div className="hm-sel">전체 유형<i className="ti ti-chevron-down" /></div>
          </div>
          <div className="hm-months">
            <span className="on">전체</span><span>11월</span><span>12월</span><span>1월</span><span>2월</span>
            <div className="hm-vt"><span className="on">목록</span><span>달력</span></div>
          </div>
          <div className="hm-fgrid">
            {six.map((f) => (
              <div className="hm-fc" key={f.id}>
                <div className="hm-im" style={f.img ? { backgroundImage: `url("${f.img}")` } : undefined}>{f.badge && <b>{f.badge}</b>}</div>
                <div className="hm-tx"><div className="t">{f.name || " "}</div><div className="m">{f.name ? `${f.city || f.region} · ~${mmdd(f.end)}` : " "}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`hm-screen ${step === 1 ? "on" : ""}`}>
        <Bar path="AI 동행 매칭" />
        <MiniNav current="AI 동행 매칭" />
        <div className="hm-mbody">
          <div className="hm-mh"><div><b>AI 동행 매칭</b><span>남산봉수의식 등 전통문화행사 · 서울 종로구</span></div></div>
          <div className="hm-two">
            <div className="hm-card">
              <div className="hm-ct">AI 챗봇<span>조건 3/3</span></div>
              <div className="hm-msg me">토요일 저녁 7시에 2명이서 조용히 구경하고 싶어</div>
              <div className="hm-msg ai">조건을 정리했어요. 잘 맞는 후보 3명을 찾았어요.</div>
              <div className="hm-slot"><span>토요일</span><span>19:00</span><span>2명</span><span>여유롭게</span></div>
              <div className="hm-chatin">조건을 더 말해 보세요<i className="ti ti-arrow-up" /></div>
            </div>
            <div className="hm-card">
              <div className="hm-ct">추천 동행 3명<span>일치 점수 60점 이상</span></div>
              {[
                ["하늘", "19:00", [["20대", 1], ["여유롭게", 1], ["전통·사진", 0]], 86, true],
                ["도윤", "18:30", [["20대", 1], ["활동적", 0], ["야경", 0]], 78, false],
                ["서연", "19:30", [["30대", 0], ["여유롭게", 1], ["산책", 0]], 71, false],
              ].map(([n, t, tags, s, sel]) => (
                <div className={`hm-cand ${sel ? "sel" : ""}`} key={n}>
                  <div className="hm-ck">{sel && <i className="ti ti-check" />}</div>
                  <div><div className="hm-cn">{n}<small>🕐 {t}~</small></div><div className="hm-tags">{tags.map(([x, hit]) => <span key={x} className={hit ? "hit" : ""}>{x}</span>)}</div></div>
                  <div className="hm-score">{s}<small>점</small></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="hm-mfoot"><span>함께할 동행 <b>1</b>/1명 선택</span><span className="hm-mbtn">모집글 만들기</span></div>
      </div>

      <div className={`hm-screen ${step === 2 ? "on" : ""}`}>
        <Bar path="모임 채팅방" />
        <MiniNav current="커뮤니티" />
        <div className="hm-mbody">
          <div className="hm-mh"><div><b>남산봉수의식 같이 즐길 동행 구해요</b><span>토요일 19:00 · 서울특별시 종로구</span></div><span className="hm-pill g">정원 마감 2/2</span></div>
          <div className="hm-room">
            <div className="hm-card">
              <div className="hm-notice">하늘님이 모임에 참여했어요</div>
              <div className="hm-bub"><div className="av"><i className="ti ti-user" /></div><div><div className="nm">하늘</div><div className="tx">7시에 남산 케이블카 앞 어때요?</div></div></div>
              <div className="hm-bub me"><div className="tx">좋아요! 그때 봬요 🙂</div></div>
              <div className="hm-bub"><div className="av"><i className="ti ti-user" /></div><div><div className="nm">하늘</div><div className="tx">비 오면 실내 행사로 바꿔도 괜찮아요</div></div></div>
              <div className="hm-chatin">메시지 입력<i className="ti ti-send" /></div>
            </div>
            <div className="hm-card">
              <div className="hm-ct">참여자<span>2/2명</span></div>
              <div className="hm-prow"><span>나</span><span className="hm-pill host">모임장</span></div>
              <div className="hm-prow"><span>하늘</span><span className="hm-pill">참여</span></div>
              <div className="hm-ct" style={{ marginTop: 12 }}>모임 정보</div>
              <div className="hm-prow"><span>승인제</span><span className="hm-pill g">마감</span></div>
              <div className="hm-prow"><span>만날 시간</span><span>19:00</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className={`hm-screen ${step === 3 ? "on" : ""}`}>
        <Bar path="AI 알림·대안" />
        <MiniNav current="내 모임" />
        <div className="hm-mbody">
          <div className="hm-mh"><div><b>AI 알림·대체 축제</b><span>모임 날짜의 실제 예보를 확인해요</span></div><span>01 날씨 확인 · <em>02 진행 여부</em> · 03 대체 축제</span></div>
          <div className="hm-band"><div className="ic"><i className="ti ti-cloud-rain" /></div><div><b>모임 시간에 비 예보가 있어요</b><small>강수확률 최대 100% · 판단 기준 60% 이상</small></div><span className="hm-mbtn">진행 여부 정하기</span></div>
          <div className="hm-wgrid">
            <div className="hm-card">
              <div className="hm-ct">모임 시간 날씨<span>Open-Meteo 실시간 예보</span></div>
              <div className="hm-big"><div><small>최대 강수확률</small><div className="n">100%</div></div><div className="hm-chips3"><div>비 예보<b>3/3시간</b></div><div>최대 바람<b>0.7m/s</b></div><div>판단 기준<b>60%</b></div></div></div>
              <div className="hm-ht">
                <div className="l">시간</div><div>19시</div><div>20시</div><div>21시</div>
                <div className="l">날씨</div><div><i className="ti ti-cloud-rain" /></div><div><i className="ti ti-cloud-rain" /></div><div><i className="ti ti-cloud-rain" /></div>
                <div className="l">강수확률</div><div className="v">100</div><div className="v">100</div><div className="v">97</div>
              </div>
            </div>
            <div className="hm-card">
              <div className="hm-ct">모임 정보</div>
              <div className="hm-tl"><b>19:00</b><span>남산봉수의식 등 전통문화행사</span></div>
              <div className="hm-ct" style={{ marginTop: 6 }}>참여자<span>2/2명</span></div>
              <div className="hm-prow flat"><span>나</span><span className="hm-pill host">모임장</span></div>
              <div className="hm-prow flat"><span>하늘</span><span className="hm-pill">참여</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
