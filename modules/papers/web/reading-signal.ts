const STORAGE_PREFIX = "paperpulse:weekly-reading:v1:";
function shanghaiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day)));
}

function weekKey(date = new Date()) {
  const day = shanghaiDate(date);
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const year = day.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((day.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function readIds(storage: Storage, key: string): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function getWeeklyReadingCount(storage: Storage = localStorage, now = new Date()) {
  return readIds(storage, `${STORAGE_PREFIX}${weekKey(now)}`).length;
}

export function recordWeeklyReading(paperId: string, storage: Storage = localStorage, now = new Date()) {
  const key = `${STORAGE_PREFIX}${weekKey(now)}`;
  const ids = readIds(storage, key);
  if (ids.includes(paperId)) return false;
  storage.setItem(key, JSON.stringify([...ids, paperId]));
  return true;
}
