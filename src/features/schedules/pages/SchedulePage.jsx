import { useCallback, useState } from "react";
import LiveSchedule from "../components/LiveSchedule.jsx";
import { ApiError } from "../../../shared/components/ApiState.jsx";
import { useFestivals } from "../../festivals/hooks/useFestivals.js";
export default function SchedulePage() {
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  const { festivals } = useFestivals();
  return failed ? <ApiError /> : <LiveSchedule festivals={festivals} onFail={onFail} />;
}
