import { useLayoutEffect, useRef } from "react";

export default function ChatHistory({
  roomId,
  messageCount,
  firstMessageId,
  children,
  ...props
}) {
  const ref = useRef(null);
  const previous = useRef(null);
  const followBottom = useRef(true);

  useLayoutEffect(() => {
    const panel = ref.current;
    const last = previous.current;
    if (!panel) return;
    if (last?.roomId !== roomId) {
      panel.scrollTop = panel.scrollHeight;
      followBottom.current = true;
    } else if (last.firstMessageId && last.firstMessageId !== firstMessageId) {
      panel.scrollTop += panel.scrollHeight - last.height;
    } else if (followBottom.current) {
      panel.scrollTop = panel.scrollHeight;
    }
    previous.current = { roomId, firstMessageId, height: panel.scrollHeight };
  }, [roomId, firstMessageId, messageCount]);

  function trackScroll(event) {
    const { scrollHeight, clientHeight, scrollTop } = event.currentTarget;
    followBottom.current = scrollHeight - clientHeight - scrollTop < 48;
  }

  return (
    <div ref={ref} {...props} onScroll={trackScroll}>
      {children}
    </div>
  );
}
