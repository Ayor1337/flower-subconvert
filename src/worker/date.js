export function nextResetTimestamp(resetDay, nowMs = Date.now()) {
  const now = new Date(nowMs);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let candidate = resetDateUtc(year, month, resetDay);

  if (candidate <= nowMs) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    candidate = resetDateUtc(year, month, resetDay);
  }

  return Math.floor(candidate / 1000);
}

function resetDateUtc(year, month, resetDay) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(resetDay, lastDay), 0, 0, 0);
}
