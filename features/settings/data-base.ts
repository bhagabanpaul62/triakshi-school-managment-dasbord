import { SchoolService } from "@smw/feature-kit";
import settingsFeature from "./feature";

export type SettingsPerm = keyof typeof settingsFeature.permissions;

/** Base of the data services (audit, exports, privacy): the settings feature and nothing else. */
export abstract class DataService extends SchoolService<SettingsPerm> {
  protected readonly feature = settingsFeature;
}

const memos = new Map<string, { until: number; value: unknown }>();
/**
 * Keep an expensive read for a short time (per process). For counts on the Settings front page that are read on every visit and do not
 * need to be to-the-second. Permissions are checked before this, never cached.
 * shortcut: per-process memory, like RateLimiter; a second app container just keeps its own copy.
 */
export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = memos.get(key);
  if (hit && hit.until > now) return hit.value as T;
  const value = await fn();
  memos.set(key, { until: now + ttlMs, value });
  if (memos.size > 500) for (const [k, m] of memos) if (m.until <= now) memos.delete(k);
  return value;
}
export const clearMemo = () => memos.clear();
