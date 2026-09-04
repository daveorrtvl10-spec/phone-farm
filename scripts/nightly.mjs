/**
 * The nightly routine, as one command rather than improvised each night:
 *   node --import tsx scripts/nightly.mjs [--dry-run]
 *
 * 1. status  2. read any health-post views that have come due  3. book tomorrow
 * 4. append the day's numbers to docs/test-account-log.md
 * Every step degrades cleanly if the Mac is asleep — it reports and moves on.
 */
import { readFile, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const API = process.env.FARM_API ?? 'http://127.0.0.1:3000';
const dryRun = process.argv.includes('--dry-run');
const here = new URL('.', import.meta.url).pathname;
const roster = JSON.parse(await readFile(new URL('../roster.json', import.meta.url), 'utf8'));
const tz = roster.tzOffsetHours ?? -5;

const run = (script, args = []) => new Promise((resolve) => {
    const child = spawn('node', ['--import', 'tsx', `${here}${script}`, ...args], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
});
const reachable = async () => {
    try { return (await fetch(`${API}/health`, { signal: AbortSignal.timeout(6000) })).ok; } catch { return false; }
};

console.log('=== 1. status');
await run('status.mjs');

const up = await reachable();
if (!up) {
    console.log('\nDashboard unreachable — skipping view reads and booking. Nothing was changed.');
    process.exit(0);
}

console.log('\n=== 2. health-post view reads that are due');
for (const account of roster.accounts) {
    const post = account.posts?.find((p) => p.kind === 'health-test');
    if (!post) continue;
    const ageHours = (Date.now() - Date.parse(post.postedAt)) / 3_600_000;
    const due = (ageHours >= 24 && post.views24h === null) ? 'views24h'
        : (ageHours >= 48 && post.views48h === null) ? 'views48h' : null;
    if (!due) { console.log(`  ${account.handle}: nothing due (${ageHours.toFixed(1)} h old)`); continue; }
    console.log(`  ${account.handle}: ${due} is due`);
    await run('read-views.mjs', ['--handle', account.handle, '--field', due, ...(dryRun ? ['--dry-run'] : [])]);
}

console.log('\n=== 3. booking tomorrow');
const tomorrow = new Date(Date.now() + tz * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
await run('plan-day.mjs', ['--date', tomorrow, '--replace', ...(dryRun ? ['--dry-run'] : [])]);

console.log('\n=== 4. logging the day');
if (!dryRun) {
    const today = new Date(Date.now() + tz * 3_600_000).toISOString().slice(0, 10);
    const lines = [`\n### ${today} (nightly)`];
    for (const account of roster.accounts) {
        try {
            const res = await fetch(`${API}/api/executions?deviceUdid=${account.device}`, { signal: AbortSignal.timeout(8000) });
            const runs = (await res.json()).executions ?? [];
            const mine = runs.filter((e) => e.payload?.account === account.handle
                && new Date(Date.parse(e.scheduledFor) + tz * 3_600_000).toISOString().slice(0, 10) === today);
            const tally = mine.reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }), {});
            lines.push(`- ${account.handle}: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ') || 'no sessions'}`);
        } catch { lines.push(`- ${account.handle}: could not read executions`); }
    }
    await appendFile(new URL('../docs/test-account-log.md', import.meta.url), `${lines.join('\n')}\n`);
    console.log('  appended to docs/test-account-log.md');
}
console.log('\nNightly done.');
