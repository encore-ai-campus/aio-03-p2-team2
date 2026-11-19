import { useCallback, useState } from "react";
import LiveChat from "../components/LiveChat.jsx";
import { ApiError } from "../../../shared/components/ApiState.jsx";
export default function ChatPage() {
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  return failed ? <ApiError /> : <LiveChat onFail={onFail} />;
}
