import { useState } from "react";
import "./style.css";

export const statusLabel = { unread: "待读", reading: "阅读中", done: "已读" };
export function useWrite(csrf: string) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function write<T>(path: string, method: string, body: unknown): Promise<T | null> {
    setBusy(true); setError("");
    try {
      const res = await fetch(path, { method, headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? `保存失败 (${res.status})`);
      return json as T;
    } catch (e) { setError((e as Error).message); return null; } finally { setBusy(false); }
  }
  return { write, busy, error, setError };
}
