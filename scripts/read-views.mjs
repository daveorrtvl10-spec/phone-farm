/**
 * Read the health post's views off the phone and write them into roster.json.
 *   node --import tsx scripts/read-views.mjs [--handle @x] [--field views24h|views48h] [--dry-run]
 *
 * Opens the account's profile, screenshots the grid and reads the play count.
 * Refuses to run while an automation is active on that phone.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { readGridViews } from '../src/planning/views.ts';

const API = process.env.FARM_API ?? 'http://127.0.0.1:3000';
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const rosterPath = new URL('../roster.json', import.meta.url);
const roster = JSON.parse(await readFile(rosterPath, 'utf8'));
const handle = value('handle', '@lucywalters35');
const account = roster.accounts.find((a) => a.handle === handle);
if (!account) { console.error(`no account ${handle} in roster.json`); process.exit(1); }

const post = account.posts.find((p) => p.kind === 'health-test');
if (!post) { console.error(`${handle} has no health-test post recorded`); process.exit(1); }
const ageHours = (Date.now() - Date.parse(post.postedAt)) / 3_600_000;
const field = value('field', ageHours >= 40 ? 'views48h' : 'views24h');

const act = (body) => fetch(`${API}/api/devices/${account.device}/remote/action`, {
    method: 'POST', headers: { origin: API, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const shot = async () => Buffer.from(await (await fetch(`${API}/api/devices/${account.device}/remote/screenshot`)).arrayBuffer());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const runs = await (await fetch(`${API}/api/executions?deviceUdid=${account.device}`)).json();
const busy = (runs.executions ?? [])[0];
if (busy && ['running', 'queued'].includes(busy.status)) {
    console.error(`${account.deviceName} is busy (${busy.status} ${busy.taskType}); not touching the phone.`);
    process.exit(1);
}

console.log(`Reading ${handle} — post is ${ageHours.toFixed(1)} h old, writing ${field}`);
await act({ type: 'unlock' }); await wait(2000);
await act({ type: 'tap', x: 373, y: 840 }); await wait(4000); // Profile tab
const views = await readGridViews(await shot(), 3);
console.log('grid play counts (newest first):', views);
await act({ type: 'home' }); await wait(800); await act({ type: 'lock' });

const newest = views[0];
if (newest === null || newest === undefined) {
    console.error('Could not read the newest tile. Leaving the roster unchanged.');
    process.exit(1);
}
console.log(`${handle} health post: ${newest} views`);
if (flag('dry-run')) process.exit(0);

post[field] = newest;
await writeFile(rosterPath, `${JSON.stringify(roster, null, 2)}\n`);
console.log(`roster.json updated (${field} = ${newest})`);
