/**
 * Plan and book a day of warm-up sessions for every account in roster.json.
 *
 *   node --import tsx scripts/plan-day.mjs [--date YYYY-MM-DD] [--dry-run] [--replace]
 *
 * --replace cancels the day's existing doomscroll bookings first, so re-running
 * is safe. Phase (lurker / training / health-test / posting) is derived from the
 * roster, never passed in.
 */
import { readFile } from 'node:fs/promises';
import { planDay } from '../src/planning/plan.ts';
import { describePhase } from '../src/planning/roster.ts';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const API = process.env.FARM_API ?? 'http://127.0.0.1:3000';
const roster = JSON.parse(await readFile(new URL('../roster.json', import.meta.url), 'utf8'));
const tz = roster.tzOffsetHours ?? -5;
const localNow = new Date(Date.now() + tz * 3_600_000);
const defaultDate = localNow.toISOString().slice(0, 10);
const date = value('date', defaultDate);

for (const account of roster.accounts) console.log(describePhase(account));

const sessions = planDay(roster.accounts, { date, tzOffsetHours: tz });
if (sessions.length === 0) {
    console.log(`No sessions to book for ${date} (all accounts blocked, or the day is over).`);
    process.exit(0);
}

const local = (iso) => new Date(Date.parse(iso) + tz * 3_600_000).toISOString().slice(11, 16);
console.log(`\nPlan for ${date} (phone local):`);
for (const s of sessions) {
    console.log(`  ${local(s.runAt)}  ${s.deviceName ?? s.device.slice(-6)}  ${s.handle.padEnd(16)} ${s.phase.padEnd(11)} ${s.personality.padEnd(7)} ${String(s.durationMinutes).padStart(2)}m  searches=${s.searchCount} follows=${s.followBudget}`);
}
if (flag('dry-run')) process.exit(0);

const post = (path, body) => fetch(`${API}${path}`, {
    method: 'POST', headers: { origin: API, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

if (flag('replace')) {
    const res = await fetch(`${API}/api/schedules`);
    const json = await res.json();
    const existing = (json.schedules ?? json).filter((s) => s.status === 'active' && s.taskType === 'doomscroll'
        && local(s.nextRunAt) !== undefined && new Date(Date.parse(s.nextRunAt) + tz * 3_600_000).toISOString().slice(0, 10) === date);
    for (const s of existing) {
        const r = await post(`/api/schedules/${s.id}/status`, { status: 'cancelled' });
        console.log(`cancelled ${s.id.slice(0, 8)} ${r.status}`);
    }
}

let booked = 0;
const failed = [];
for (const s of sessions) {
    const form = new URLSearchParams({
        scheduleKind: 'once', runAt: s.runAt, durationMinutes: String(s.durationMinutes),
        personality: s.personality, likeEnabled: 'on', runWindowMinutes: '15', account: s.handle,
        ...(s.saveEnabled ? { saveEnabled: 'on' } : {}),
        ...(s.searchCount ? { searchCount: String(s.searchCount), seedTerms: s.seedTerms.join(',') } : {}),
        ...(s.followBudget ? { followBudget: String(s.followBudget) } : {}),
    });
    // The Mac sleeps mid-loop often enough that one dropped connection must not
    // abandon the rest of the day, or leave us guessing what landed.
    try {
        const res = await fetch(`${API}/api/devices/${s.device}/fragments/scroll-run`, {
            method: 'POST', headers: { origin: API, 'content-type': 'application/x-www-form-urlencoded' }, body: form,
            signal: AbortSignal.timeout(15000),
        });
        if (res.ok) booked += 1;
        else { failed.push(`${local(s.runAt)} ${s.handle} (${res.status})`); console.error(`  FAILED ${local(s.runAt)} ${s.handle}: ${res.status}`); }
    } catch (error) {
        failed.push(`${local(s.runAt)} ${s.handle} (${error instanceof Error ? error.message : error})`);
        console.error(`  FAILED ${local(s.runAt)} ${s.handle}: ${error instanceof Error ? error.message : error}`);
    }
}
console.log(`\nBooked ${booked}/${sessions.length} sessions for ${date}.`);
if (failed.length) {
    console.log(`Not booked (re-run with --replace when the Mac is up):\n  - ${failed.join('\n  - ')}`);
    process.exitCode = booked > 0 ? 0 : 1;
}
