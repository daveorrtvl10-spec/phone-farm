import { accountPhase, type Account, type Phase } from './roster.js';

/**
 * Turns the roster into a day of booked sessions.
 *
 * Everything a human would vary is varied: how many sessions, how long, which
 * minute inside a window. Nothing lands on a round number, and two accounts on
 * the SAME phone can never overlap — the phone can only drive one at a time.
 */
export interface PlannedSession {
    handle: string;
    device: string;
    /** UTC ISO. */
    runAt: string;
    durationMinutes: number;
    personality: 'skimmer' | 'casual' | 'engaged';
    likeEnabled: boolean;
    saveEnabled: boolean;
    searchCount: number;
    followBudget: number;
    seedTerms: string[];
    phase: Phase;
}

/** Golden windows in the phone's local hours (playbook §4). */
export const GOLDEN_WINDOWS: Array<[number, number]> = [[6, 8], [10, 12], [17, 20]];

/** Minutes a phone needs between two sessions so they cannot run together. */
export const DEVICE_GAP_MINUTES = 8;

export interface PhaseShape {
    sessions: number;
    minMinutes: number;
    maxMinutes: number;
    personalities: Array<PlannedSession['personality']>;
    saves: boolean;
    searches: number;
    /** Follows stay 0 until the follow "+" is measured on a live video. */
    follows: number;
}

export const PHASE_SHAPES: Record<Phase, PhaseShape> = {
    lurker: { sessions: 3, minMinutes: 8, maxMinutes: 15, personalities: ['skimmer', 'skimmer', 'casual'], saves: false, searches: 0, follows: 0 },
    training: { sessions: 4, minMinutes: 10, maxMinutes: 18, personalities: ['casual', 'casual', 'engaged', 'engaged'], saves: true, searches: 1, follows: 0 },
    'health-test': { sessions: 3, minMinutes: 10, maxMinutes: 16, personalities: ['casual', 'engaged', 'engaged'], saves: true, searches: 1, follows: 0 },
    posting: { sessions: 3, minMinutes: 10, maxMinutes: 16, personalities: ['casual', 'engaged', 'engaged'], saves: true, searches: 1, follows: 0 },
    blocked: { sessions: 0, minMinutes: 0, maxMinutes: 0, personalities: [], saves: false, searches: 0, follows: 0 },
};

/** Small deterministic PRNG so a given day/seed always plans the same way. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function seedFromString(text: string): number {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function randomInt(random: () => number, min: number, max: number): number {
    return min + Math.floor(random() * (max - min + 1));
}

export interface PlanOptions {
    /** Local date the plan is for, YYYY-MM-DD in the phone's timezone. */
    date: string;
    /** Phone timezone offset from UTC, e.g. -5. */
    tzOffsetHours: number;
    now?: number;
    random?: () => number;
    /** Skip slots already in the past (plus this many minutes of lead time). */
    leadMinutes?: number;
}

/** Local wall-clock minute-of-day → UTC epoch ms. */
function localToUtc(date: string, minuteOfDay: number, tzOffsetHours: number): number {
    const midnightUtc = Date.parse(`${date}T00:00:00Z`);
    return midnightUtc + (minuteOfDay - tzOffsetHours * 60) * 60_000;
}

export function planDay(accounts: Account[], options: PlanOptions): PlannedSession[] {
    const { date, tzOffsetHours } = options;
    const now = options.now ?? Date.now();
    const leadMinutes = options.leadMinutes ?? 6;
    const random = options.random ?? mulberry32(seedFromString(date));

    // Booked spans per device, so two accounts on one phone never collide.
    const busy = new Map<string, Array<[number, number]>>();
    const fits = (device: string, start: number, end: number): boolean =>
        !(busy.get(device) ?? []).some(([s, e]) => start < e + DEVICE_GAP_MINUTES * 60_000 && s - DEVICE_GAP_MINUTES * 60_000 < end);
    const claim = (device: string, start: number, end: number): void => {
        busy.set(device, [...(busy.get(device) ?? []), [start, end]]);
    };

    const planned: PlannedSession[] = [];
    for (const account of accounts) {
        const phase = accountPhase(account, now);
        const shape = PHASE_SHAPES[phase];
        if (shape.sessions === 0) continue;

        for (let index = 0; index < shape.sessions; index += 1) {
            // Spread sessions across the windows, reusing the long evening one last.
            const [fromHour, toHour] = GOLDEN_WINDOWS[index % GOLDEN_WINDOWS.length]!;
            const duration = randomInt(random, shape.minMinutes, shape.maxMinutes);
            const windowStart = fromHour * 60;
            const windowEnd = toHour * 60 - duration;
            if (windowEnd <= windowStart) continue;

            let booked = false;
            for (let attempt = 0; attempt < 24 && !booked; attempt += 1) {
                const minute = randomInt(random, windowStart, windowEnd);
                const start = localToUtc(date, minute, tzOffsetHours);
                const end = start + duration * 60_000;
                if (start < now + leadMinutes * 60_000) continue;
                if (!fits(account.device, start, end)) continue;
                claim(account.device, start, end);
                planned.push({
                    handle: account.handle,
                    device: account.device,
                    runAt: new Date(start).toISOString(),
                    durationMinutes: duration,
                    personality: shape.personalities[Math.min(index, shape.personalities.length - 1)] ?? 'casual',
                    likeEnabled: true,
                    saveEnabled: shape.saves,
                    searchCount: shape.searches === 0 ? 0 : randomInt(random, shape.searches, shape.searches + 1),
                    followBudget: shape.follows,
                    seedTerms: shape.searches === 0 ? [] : account.seedTerms,
                    phase,
                });
                booked = true;
            }
        }
    }
    return planned.sort((a, b) => (a.runAt < b.runAt ? -1 : 1));
}
