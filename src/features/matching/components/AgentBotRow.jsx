// 챗봇 말풍선 줄(아바타 + 내용) + 에이전트 실행 과정 펼침(시연용)
export function BotRow({ children }) {
  return (
    <div className="ai-row bot">
      <span className="ai-ava"><img src="/brand/festamate_icon.png" alt="" /></span>
      <div className="ai-col">{children}</div>
    </div>
  );
}

// 에이전트가 어떤 단계·도구를 거쳤는지
export function TraceBox({ res }) {
  return res?.trace?.length ? (
    <details className="ai-dev">
      <summary>
        <i className="ti ti-tool" aria-hidden="true" /> 에이전트 실행 과정 · 단계 {res.trace.length}개 · 도구 호출 {res.toolCalls?.length || 0}회 · 수정 {res.iteration}회
      </summary>
      <pre>
        {res.trace
          .map((t, i) => `${i + 1}. ${t.node}${t.tools?.length ? ` → ${t.tools.join(", ")}` : ""}${t.summary ? ` · ${t.summary}` : ""}`)
          .join("\n")}
      </pre>
    </details>
  ) : null;
}
