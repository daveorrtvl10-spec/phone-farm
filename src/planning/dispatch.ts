import type { PlannedSession } from './plan.js';

/**
 * Splitting "work out the day" from "send the requests".
 *
 * Learned the hard way overnight 2026-09-03/04: the Mac was waking for only a few
 * seconds at a time, and simply STARTING the planner costs 10–20 s of TypeScript
 * compilation — so every attempt slept before it reached its first HTTP call.
 * Computing the plan offline and firing pre-built bodies makes each request cost
 * milliseconds, so a short wake window is enough, and recording what landed makes
 * the whole thing resumable instead of all-or-nothing.
 */
export interface BookingRequest {
    index: number;
    device: string;
    /** application/x-www-form-urlencoded body, ready to send. */
    body: string;
}

export function toRequestBodies(sessions: PlannedSession[]): BookingRequest[] {
    return sessions.map((session, index) => {
        const form = new URLSearchParams({
            scheduleKind: 'once',
            runAt: session.runAt,
            durationMinutes: String(session.durationMinutes),
            personality: session.personality,
            likeEnabled: session.likeEnabled ? 'on' : 'off',
            runWindowMinutes: '15',
            account: session.handle,
        });
        if (session.saveEnabled) form.set('saveEnabled', 'on');
        if (session.searchCount > 0) {
            form.set('searchCount', String(session.searchCount));
            form.set('seedTerms', session.seedTerms.join(','));
        }
        if (session.followBudget > 0) form.set('followBudget', String(session.followBudget));
        return { index, device: session.device, body: form.toString() };
    });
}

/** Requests still to send, given the indexes already accepted. */
export function remaining(requests: BookingRequest[], done: Iterable<number>): BookingRequest[] {
    const sent = new Set(done);
    return requests.filter((request) => !sent.has(request.index));
}

/** Parse a done-file: one accepted index per line, blanks and junk ignored. */
export function parseDone(text: string): number[] {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line))
        .map(Number);
}
