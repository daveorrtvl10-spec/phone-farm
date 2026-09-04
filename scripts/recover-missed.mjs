/**
 * Re-run sessions lost to an outage, while their golden window is still open.
 *   node --import tsx scripts/recover-missed.mjs [--dry-run]
 * Safe to call repeatedly: it re-reads live state and applies its own gap and
 * per-account caps each time.
 */
import { readFile } from 'node:fs/promises';
import { sessionsToRecover } from '../src/planning/recover.ts';

const API = process.env.FARM_API ?? 'http://127.0.0.1:3000';
const dryRun = process.argv.includes('--dry-run');
const roster = JSON.parse(await readFile(new URL('../roster.json', import.meta.url), 'utf8'));
const tz = roster.tzOffsetHours ?? -5;

const devices = [...new Set(roster.accounts.map((a) => a.device))];
const executions = [];
for (const device of devices) {
    // The watcher calls this the moment a phone reconnects, which is exactly when
    // the dashboard may still be coming back. Never throw at it.
    try {
        const res = await fetch(`${API}/api/executions?deviceUdid=${device}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) { console.error(`could not read executions for ${device.slice(-6)}: ${res.status}`); continue; }
        const json = await res.json();
        executions.push(...(json.executions ?? []));
    } catch (error) {
        console.error(`dashboard unreachable for ${device.slice(-6)}: ${error instanceof Error ? error.message : error}`);
    }
}
if (executions.length === 0) { console.log('Nothing to recover right now.'); process.exit(0); }

// A disconnected phone cannot run anything, and re-booking onto one burns the
// day's recovery budget on runs that expire offline immediately. Only recover
// for devices that are actually ready.
const ready = new Set();
for (const device of devices) {
    try {
        const res = await fetch(`${API}/api/devices/${device}/connection`, { signal: AbortSignal.timeout(8000) });
        const conn = await res.json();
        if (conn.physical === 'connected' && conn.wda === 'ready') ready.add(device);
        else console.log(`skipping ${device.slice(-6)}: ${conn.physical}/${conn.wda}`);
    } catch { console.log(`skipping ${device.slice(-6)}: connection unknown`); }
}

const recover = sessionsToRecover(executions, { now: Date.now(), tzOffsetHours: tz, readyDevices: ready });
if (recover.length === 0) { console.log('Nothing to recover right now.'); process.exit(0); }

for (const execution of recover) {
    const p = execution.payload;
    const form = new URLSearchParams({
        scheduleKind: 'now', durationMinutes: String(p.durationMinutes ?? 12),
        personality: p.personality ?? 'casual', likeEnabled: 'on', runWindowMinutes: '20',
        ...(p.account ? { account: p.account } : {}),
        ...(p.saveEnabled ? { saveEnabled: 'on' } : {}),
        ...(p.searchCount ? { searchCount: String(p.searchCount), seedTerms: (p.seedTerms ?? []).join(',') } : {}),
    });
    console.log(`recover ${p.account ?? execution.deviceUdid.slice(-6)} ${p.durationMinutes}m ${p.personality} (missed ${execution.scheduledFor.slice(11, 16)}Z)`);
    if (dryRun) continue;
    try {
        const res = await fetch(`${API}/api/devices/${execution.deviceUdid}/fragments/scroll-run`, {
            method: 'POST', headers: { origin: API, 'content-type': 'application/x-www-form-urlencoded' }, body: form,
            signal: AbortSignal.timeout(20000),
        });
        console.log(`  -> ${res.status}`);
    } catch (error) {
        console.error(`  -> failed: ${error instanceof Error ? error.message : error}`);
    }
}
