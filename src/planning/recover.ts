import { GOLDEN_WINDOWS } from './plan.js';

/**
 * Recovering sessions lost to an outage.
 *
 * On 2026-09-03 the Mac slept overnight and both phones came off USB; six booked
 * sessions expired as "device is offline" and the day was simply lost. When a
 * device comes back, any session missed EARLIER TODAY should re-run — but only
 * while its golden window is still open, only if the account has not just run,
 * and only a couple of times, so a long outage cannot cause a burst of activity
 * that looks nothing like a person.
 */
export interface ExecutionSummary {
    id: string;
    deviceUdid: string;
    taskType: string;
    status: string;
    error?: string | null;
    scheduledFor: string;
    startedAt?: string | null;
    payload: {
        account?: string;
        personality?: 'skimmer' | 'casual' | 'engaged';
        durationMinutes?: number;
        saveEnabled?: boolean;
        searchCount?: number;
        seedTerms?: string[];
        followBudget?: number;
    };
}

export interface RecoverOptions {
    now: number;
    tzOffsetHours: number;
    /** Don't re-run if the account ran successfully within this many minutes. */
    minGapMinutes?: number;
    /** Cap on recoveries per account per day. */
    maxPerAccount?: number;
    /** Minutes of window the session still needs to fit. */
    leadMinutes?: number;
}

const OFFLINE = /device is offline|window expired/i;

function localMinutes(epochMs: number, tzOffsetHours: number): number {
    const local = new Date(epochMs + tzOffsetHours * 3_600_000);
    return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function localDate(epochMs: number, tzOffsetHours: number): string {
    return new Date(epochMs + tzOffsetHours * 3_600_000).toISOString().slice(0, 10);
}

/** Is there room to run `durationMinutes` inside a golden window right now? */
export function windowHasRoom(now: number, tzOffsetHours: number, durationMinutes: number, leadMinutes = 2): boolean {
    const minute = localMinutes(now, tzOffsetHours);
    return GOLDEN_WINDOWS.some(([from, to]) => minute >= from * 60 && minute + durationMinutes + leadMinutes <= to * 60);
}

export function sessionsToRecover(executions: ExecutionSummary[], options: RecoverOptions): ExecutionSummary[] {
    const { now, tzOffsetHours } = options;
    const minGap = (options.minGapMinutes ?? 75) * 60_000;
    const maxPerAccount = options.maxPerAccount ?? 2;
    const today = localDate(now, tzOffsetHours);

    const ranRecently = new Map<string, number>();
    for (const execution of executions) {
        if (execution.status !== 'succeeded') continue;
        const at = Date.parse(execution.startedAt ?? execution.scheduledFor);
        const account = execution.payload.account ?? execution.deviceUdid;
        if (Number.isFinite(at)) ranRecently.set(account, Math.max(ranRecently.get(account) ?? 0, at));
    }

    const recovered: ExecutionSummary[] = [];
    const perAccount = new Map<string, number>();
    // Oldest missed first, so the day is rebuilt in order.
    const missed = executions
        .filter((e) => e.taskType === 'doomscroll' && e.status === 'failed' && OFFLINE.test(e.error ?? ''))
        .filter((e) => localDate(Date.parse(e.scheduledFor), tzOffsetHours) === today)
        .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));

    for (const execution of missed) {
        const account = execution.payload.account ?? execution.deviceUdid;
        const duration = execution.payload.durationMinutes ?? 12;
        if ((perAccount.get(account) ?? 0) >= maxPerAccount) continue;
        if (!windowHasRoom(now, tzOffsetHours, duration, options.leadMinutes)) continue;
        const last = ranRecently.get(account);
        if (last !== undefined && now - last < minGap) continue;
        recovered.push(execution);
        perAccount.set(account, (perAccount.get(account) ?? 0) + 1);
        // A recovered session counts as a run for spacing the next one.
        ranRecently.set(account, now);
    }
    return recovered;
}
