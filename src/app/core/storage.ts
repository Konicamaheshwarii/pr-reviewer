/** localStorage that never throws (private mode, blocked storage, quota). */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Returns false when the value could not be stored (quota exceeded or storage blocked). */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // storage unavailable: the app keeps working in memory
    return false;
  }
}
