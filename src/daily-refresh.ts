/** The same device-local wall clock used by the market, independent of story time. */
export function localDayKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function nextLocalMidnight(date = new Date()): Date {
  const next = new Date(date);
  next.setDate(next.getDate()+1);
  next.setHours(0,0,0,0);
  return next;
}
