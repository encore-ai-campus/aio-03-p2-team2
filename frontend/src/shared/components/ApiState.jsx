// 실서버 화면 공통 상태: 불러오는 중(스켈레톤) / 서버 연결 실패
// 연결 실패를 예시 데이터로 숨기지 않고 오류를 안내한다.
export function ApiLoading({ text = "불러오는 중…" }) {
  return (
    <div className="api-loading" role="status" aria-live="polite">
      <div className="sk sk-title" />
      <div className="sk sk-line" />
      <div className="sk-grid">
        <div className="sk sk-card" />
        <div className="sk sk-card" />
      </div>
      <span className="sr-only">{text}</span>
    </div>
  );
}

export function ApiError({ title = "서버에 연결할 수 없어요", onRetry }) {
  return (
    <div className="api-error" role="alert">
      <i className="ti ti-plug-connected-x" aria-hidden="true" />
      <b>{title}</b>
      <span>
        백엔드 서버가 켜져 있는지 확인한 뒤 다시 시도해 주세요.
        <br />
        (백엔드 폴더에서 <code>uv run uvicorn app.main:app --reload</code>)
      </span>
      <button type="button" className="btn primary" onClick={onRetry || (() => window.location.reload())}>
        다시 시도
      </button>
    </div>
  );
}
