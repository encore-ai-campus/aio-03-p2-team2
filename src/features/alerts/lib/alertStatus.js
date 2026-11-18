export const isVisibleAlert = (alert) => alert.status !== "dismissed" && alert.choice !== "dismiss";

export const needsWeatherResponse = (alert) =>
  alert.type === "rain" && isVisibleAlert(alert) && alert.status !== "answered" && !alert.choice;
