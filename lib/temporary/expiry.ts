/** Display helpers only. Database clock_timestamp() enforces access deadlines. */
export function guestExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + 5 * 60 * 60 * 1000);
}

export function nextDemoReset(now: Date): Date {
  // Asia/Manila is UTC+08:00 without daylight saving time.
  const day = 24 * 60 * 60 * 1000;
  const offset = 8 * 60 * 60 * 1000;
  return new Date((Math.floor((now.getTime() + offset) / day) + 1) * day - offset);
}
