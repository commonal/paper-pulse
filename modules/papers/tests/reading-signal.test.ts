import test from "node:test";
import assert from "node:assert/strict";
import { getWeeklyReadingCount, recordWeeklyReading } from "../web/reading-signal.ts";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
    clear: () => values.clear(),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
}

test("weekly reading signal counts each paper once per Shanghai week", () => {
  const storage = memoryStorage();
  const firstWeek = new Date("2026-10-06T02:00:00.000Z");
  const sameWeek = new Date("2026-10-11T15:00:00.000Z");
  const nextWeek = new Date("2026-10-12T00:30:00.000Z");

  assert.equal(recordWeeklyReading("paper-a", storage, firstWeek), true);
  assert.equal(recordWeeklyReading("paper-a", storage, sameWeek), false);
  assert.equal(recordWeeklyReading("paper-b", storage, sameWeek), true);
  assert.equal(getWeeklyReadingCount(storage, sameWeek), 2);
  assert.equal(getWeeklyReadingCount(storage, nextWeek), 0);
  assert.equal(recordWeeklyReading("paper-a", storage, nextWeek), true);
  assert.equal(getWeeklyReadingCount(storage, nextWeek), 1);
});
