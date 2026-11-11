export default function DemoActorSelect({ value, onChange }) {
  return (
    <select
      id="actor"
      aria-label="데모 사용자 변경"
      value={value}
      onChange={onChange}
    >
      <option value="me">👑 나 · 모임장</option>
      <option value="haneul">👩 하늘 · 신청자</option>
      <option value="guest">🙋 새 참가자</option>
      <option value="minji">👑 민지 · 전주 모임장</option>
      <option value="junho">👑 준호 · 강릉 모임장</option>
    </select>
  );
}
