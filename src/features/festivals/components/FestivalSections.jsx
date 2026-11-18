// 축제 목록: 기간 한정 축제 / 상시·장기 운영(4개 넘으면 접기) / 결과 없음
import { Fragment } from "react";

export default function FestivalSections({ ui, x }) {
  const { btn, fCard } = ui;
  const { activeMonth, limited, longRun, showLong, pastMonth } = x;
  if (!x.filtered.length)
    return (
      <>
        <div className="empty">
          <div className="big"><i className="ti ti-search-off" aria-hidden="true" /></div>
          <h3>조건에 맞는 축제가 없어요</h3>
          <p>다른 달 또는 다른 지역을 선택해 보세요.</p>
        </div>
      </>
    );
  return (
    <>
      {limited.length ? (
        <>
          <div className="fx-sec">
            <b>{activeMonth ? `${activeMonth}월에 열리는 축제` : "기간 한정 축제"}</b>
            <span>{limited.length}건</span>
          </div>
          <div className="festival-grid">
            {limited.map((item) => (
              <Fragment key={item.id}>{fCard(item)}</Fragment>
            ))}
          </div>
        </>
      ) : (
        <div className="fx-none">
          {pastMonth ? (
            <>
              <span>{activeMonth}월 축제는 모두 끝났어요. 지금 참여할 수 있는 행사는 아래 상시 운영을 확인해 보세요.</span>
              {btn("지난 축제 보기", "status:all", "btn small")}
            </>
          ) : (
            <span>{activeMonth ? `${activeMonth}월에 열리는 기간 한정 축제가 없어요.` : "기간 한정 축제가 없어요."} 아래 상시 운영 행사를 확인해 보세요.</span>
          )}
        </div>
      )}
      {longRun.length > 0 && (
        <>
          <div className="fx-sec long">
            <b>상시·장기 운영</b>
            <span>{longRun.length}건 · 언제 가도 열려 있어요</span>
            {longRun.length > 4 && (
              <button type="button" className="fx-more" onClick={x.toggleLong}>
                {showLong ? "접기" : `전체 보기 (${longRun.length})`}
              </button>
            )}
          </div>
          <div className="festival-grid">
            {(showLong ? longRun : longRun.slice(0, 4)).map((item) => (
              <Fragment key={item.id}>{fCard(item)}</Fragment>
            ))}
          </div>
        </>
      )}
    </>
  );
}
