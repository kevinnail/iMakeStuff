// "4h 10m", or "10m" under an hour.
export function formatDuration(milliseconds: number) {
  const totalMinutes = Math.floor(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// "Oct 28"
export function formatDay(milliseconds: number) {
  return new Date(milliseconds).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// "9:00 AM"
export function formatClockTime(milliseconds: number) {
  return new Date(milliseconds).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// "Nov 6, 9:15 AM to 10:00 AM". The end has its own day when it's on another one, and is "now"
// while the entry runs.
export function formatTimeRange(start: number, end: number | null) {
  const endText =
    end === null
      ? 'now'
      : formatDay(end) === formatDay(start)
        ? formatClockTime(end)
        : `${formatDay(end)}, ${formatClockTime(end)}`;
  return `${formatDay(start)}, ${formatClockTime(start)} to ${endText}`;
}
