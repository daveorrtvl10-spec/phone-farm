/**
 * One-glance farm status: node --import tsx scripts/status.mjs
 * Works (partially) even when the Mac is asleep — it says so rather than hanging.
 */
import { readFile } from 'node:fs/promises';
import { describePhase, healthTestPost, bestViews, HEALTHY_VIEWS, COMPROMISED_VIEWS } from '../src/planning/roster.ts';

const API = process.env.FARM_API ?? 'http://127.0.0.1:3000';
const roster = JSON.parse(await readFile(new URL('../roster.json', import.meta.url), 'utf8'));
const tz = roster.tzOffsetHours ?? -5;
const local = (ms) => new Date(ms + tz * 3_600_000).toISOString().slice(11, 16);
const phoneNow = new Date(Date.now() + tz * 3_600_000);

const get = async (path) => {
    try {
        const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(8000) });
        return res.ok ? await res.json() : null;
    } catch { return null; }
};

console.log(`\nPHONE FARM — ${phoneNow.toISOString().slice(0, 16).replace('T', ' ')} phone time (UTC${tz})\n`);

const health = await get('/health');
if (!health) {
    console.log('  Dashboard unreachable — the Mac is asleep or the tunnel is down.');
    console.log('  Everything below is from the roster only.\n');
}

for (const account of roster.accounts) {
    console.log(`${account.handle}  (${account.deviceName}, ${account.niche})`);
    console.log(`  ${describePhase(account)}`);

    const post = healthTestPost(account);
    if (post) {
        const views = bestViews(post);
        const verdict = views === null ? 'not read yet'
            : views >= HEALTHY_VIEWS ? `${views} views — HEALTHY, content can start`
                : views < COMPROMISED_VIEWS ? `${views} views — COMPROMISED, reset the account`
                    : `${views} views — inconclusive, post one more warm-up`;
        const age = ((Date.now() - Date.parse(post.postedAt)) / 3_600_000).toFixed(1);
        console.log(`  health post: ${age} h old, ${verdict}`);
    }

    if (health) {
        const conn = await get(`/api/devices/${account.device}/connection`);
        console.log(`  device: ${conn ? `${conn.physical}/${conn.wda}` : 'unknown'}`);
        const runs = await get(`/api/executions?deviceUdid=${account.device}`);
        const today = (runs?.executions ?? [])
            .filter((e) => e.payload?.account === account.handle)
            .filter((e) => new Date(Date.parse(e.scheduledFor) + tz * 3_600_000).toISOString().slice(0, 10) === phoneNow.toISOString().slice(0, 10));
        const tally = today.reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }), {});
        console.log(`  today: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing yet'}`);
    }
    console.log('');
}

if (health) {
    const schedules = await get('/api/schedules');
    const upcoming = (schedules?.schedules ?? schedules ?? [])
        .filter((s) => s.status === 'active')
        .sort((a, b) => (a.nextRunAt < b.nextRunAt ? -1 : 1));
    console.log(`Upcoming (${upcoming.length}):`);
    for (const s of upcoming.slice(0, 8)) {
        console.log(`  ${local(Date.parse(s.nextRunAt))}  ${s.payload?.account ?? s.deviceUdid.slice(-6)}  ${s.payload?.personality ?? s.taskType} ${s.payload?.durationMinutes ?? ''}m`);
    }
    const assist = await get('/api/assist');
    const waiting = (assist?.requests ?? []).filter((r) => r.state === 'waiting');
    if (waiting.length) {
        console.log(`\nWAITING FOR AN OPERATOR (${waiting.length}):`);
        for (const r of waiting) console.log(`  ${r.udid.slice(-6)} ${r.step}: ${r.reason}`);
    }
}
console.log('');
