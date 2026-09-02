import type { JsonObject } from '../types.js';

export const WARMUP_HOURS_DEFAULT = 48;

export interface WarmupEntry { startedAt: string; hours?: number }
export type WarmupMap = Record<string, WarmupEntry>;

function normalize(handle: string): string {
    const trimmed = handle.trim();
    return (trimmed.startsWith('@') ? trimmed : `@${trimmed}`).toLowerCase();
}

export function warmupMap(pluginData: JsonObject | undefined): WarmupMap {
    const raw = (pluginData as { warmup?: unknown } | undefined)?.warmup;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const map: WarmupMap = {};
    for (const [handle, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value && typeof value === 'object' && typeof (value as WarmupEntry).startedAt === 'string') {
            map[normalize(handle)] = value as WarmupEntry;
        }
    }
    return map;
}

/** Milliseconds of warm-up still to run for `handle`, or 0 when clear (or never warmed). */
export function warmupRemainingMs(pluginData: JsonObject | undefined, handle: string, now = Date.now()): number {
    const entry = warmupMap(pluginData)[normalize(handle)];
    if (!entry) return 0;
    const started = Date.parse(entry.startedAt);
    if (!Number.isFinite(started)) return 0;
    const ends = started + (entry.hours ?? WARMUP_HOURS_DEFAULT) * 3_600_000;
    return Math.max(0, ends - now);
}

export function describeRemaining(ms: number): string {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.round((ms % 3_600_000) / 60_000);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
