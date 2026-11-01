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
