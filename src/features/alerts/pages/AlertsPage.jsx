import { useCallback, useState } from "react";
import LiveAlerts from "../components/LiveAlerts.jsx";
import { ApiError } from "../../../shared/components/ApiState.jsx";
import { useFestivals } from "../../festivals/hooks/useFestivals.js";
export default function AlertsPage() {
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  const { festivals } = useFestivals();
  return failed ? <ApiError /> : <LiveAlerts festivals={festivals} onFail={onFail} />;
}
