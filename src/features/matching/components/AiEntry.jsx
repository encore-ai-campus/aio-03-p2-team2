import { forwardRef } from "react";
import { Button, Pill } from "../../../shared/components/Primitives.jsx";

// 매칭 화면 상단의 "말로 요청하기" 진입 배너
const AiEntry = forwardRef(function AiEntry({ onOpen }, ref) {
  return (
    <section className="ai-entry" ref={ref}>
      <div className="ai-entry-ico">💬</div>
      <div>
        <div className="ai-entry-title">
          조건 고르기 번거롭다면, AI에게 말로 요청하세요 <Pill variant="red">NEW</Pill>
        </div>
        <p>
          “부산 음악축제, 3시부터, 10만원, 공연·사진 좋아해요”처럼 적으면 아래 매칭 조건으로
          자동 변환해 같은 방식으로 매칭해요.
        </p>
      </div>
      <Button className="ai-entry-input" onClick={onOpen}>
        가고 싶은 축제와 원하는 동행을 적어보세요…<span>✍️ 말로 입력</span>
      </Button>
    </section>
  );
});

export default AiEntry;
