// 채팅 화면 공통 상태 안내 (불러오는 중·잠김·실패·빈 목록)
export default function ChatState({ icon, title, desc, action }) {
  return (
    <div className="ct-state">
      <i className={`ti ${icon}`} aria-hidden="true" />
      <b>{title}</b>
      {desc ? <span>{desc}</span> : null}
      {action}
    </div>
  );
}
