import { useEffect, useRef } from "react";
export default function ChatHistory({
  roomId,
  messageCount,
  children,
  ...props
}) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [roomId, messageCount]);
  return (
    <div ref={ref} {...props}>
      {children}
    </div>
  );
}
