import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

import type { PhoneFarmPlugin, TaskDefinition, TaskExecutionContext } from './plugin.js';
import { assistDirectory, readAssist, resolveAssist } from './tiktok/assist.js';
import { describeRemaining, warmupMap, warmupRemainingMs, WARMUP_HOURS_DEFAULT } from './tiktok/warmup.js';
import { readdir } from 'node:fs/promises';
import type { JsonObject, JsonValue, ScheduleTiming } from './types.js';

export interface TikTokPluginConfiguration {
    doomscrollEntrypoint?: string;
    postEntrypoint?: string;
    bundleId?: string;
}

type DoomscrollPayload = JsonObject & {
    durationMinutes: number;
    personality: 'skimmer' | 'casual' | 'engaged';
    likeEnabled: boolean;
    saveEnabled: boolean;
    account?: string;
    /** Warm-up seeding (docs/WARMUP.md). */
    followBudget?: number;
    seedTerms?: string[];
    searchCount?: number;
};

// TikTok accepts up to 35 slideshow images, but the picker taps are grid
// math over the visible rows: on the measured layouts 4 rows × 3 columns fit
// above the selection tray without scrolling. Raise this only together with
// grid scrolling in src/tiktok/post-layout.ts.
export const MAX_POST_MEDIA = 12;

type PostMedia = JsonObject & {
    assetId: string;
    name: string;
    mimeType: string;
};

type PostPayload = JsonObject & {
    media: PostMedia[];
    destination: 'draft' | 'publish';
    account: string;
    caption?: string;
    musicUrl?: string;
    recurringPublishConfirmed?: boolean;
};

function objectPayload(value: JsonValue): Record<string, JsonValue> {
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Payload must be an object');
    return value;
}

function optionalString(value: JsonValue | undefined, name: string): string | undefined {
    if (value === undefined) return;
    if (typeof value !== 'string') throw new Error(`${name} must be a string`);
    return value;
}

function createDoomscrollTask(configuration: TikTokPluginConfiguration): TaskDefinition<DoomscrollPayload> {
    return {
        type: 'doomscroll', version: 1, displayName: 'TikTok doomscroll',
        validate(value) {
            const input = objectPayload(value);
            const durationMinutes = input.durationMinutes;
            const personality = input.personality;
            if (!Number.isInteger(durationMinutes) || typeof durationMinutes !== 'number' || durationMinutes < 1 || durationMinutes > 180) {
                throw new Error('durationMinutes must be between 1 and 180');
            }
            if (personality !== 'skimmer' && personality !== 'casual' && personality !== 'engaged') {
                throw new Error('Invalid personality');
            }
            if (typeof input.likeEnabled !== 'boolean' || typeof input.saveEnabled !== 'boolean') {
                throw new Error('Engagement settings must be boolean');
            }
            const account = optionalString(input.account, 'account');
            const followBudget = input.followBudget === undefined ? undefined : Number(input.followBudget);
            if (followBudget !== undefined && (!Number.isInteger(followBudget) || followBudget < 0 || followBudget > 20)) throw new Error('followBudget must be 0–20');
            const searchCount = input.searchCount === undefined ? undefined : Number(input.searchCount);
            if (searchCount !== undefined && (!Number.isInteger(searchCount) || searchCount < 0 || searchCount > 5)) throw new Error('searchCount must be 0–5');
            const seedTerms = input.seedTerms === undefined ? undefined
                : (Array.isArray(input.seedTerms) ? input.seedTerms : [input.seedTerms]).map((term) => String(term).trim()).filter(Boolean).slice(0, 12);
            return {
                durationMinutes, personality, likeEnabled: input.likeEnabled, saveEnabled: input.saveEnabled,
                ...(account ? { account } : {}),
                ...(followBudget ? { followBudget } : {}),
                ...(searchCount ? { searchCount } : {}),
                ...(seedTerms?.length ? { seedTerms } : {}),
            };
        },
        summarize: (payload) => `Doomscroll · ${payload.personality} · ${payload.durationMinutes} min${payload.followBudget || payload.searchCount ? ' · seeding' : ''}`,
        estimateDurationMs: (payload) => payload.durationMinutes * 60_000,
        retryPolicy: () => ({ retryLimit: 2, retryDelaySeconds: 60, retryBackoff: true }),
        supportsStop: () => true,
        execute: (context, payload) => context.runProcess({
            entrypoint: configuration.doomscrollEntrypoint ?? fileURLToPath(new URL('./tiktok/doomscroll.ts', import.meta.url)),
            env: {
                IOS_UDID: context.device.udid,
                TIKTOK_BUNDLE_ID: configuration.bundleId ?? 'com.zhiliaoapp.musically',
                DOOMSCROLL_DURATION_MINUTES: String(payload.durationMinutes),
                DOOMSCROLL_PERSONALITY: payload.personality,
                DOOMSCROLL_LIKE_ENABLED: String(payload.likeEnabled),
                DOOMSCROLL_SAVE_ENABLED: String(payload.saveEnabled),
                ...(payload.account ? { TIKTOK_SWITCH_ACCOUNT: payload.account } : {}),
                ...(payload.followBudget ? { DOOMSCROLL_FOLLOW_BUDGET: String(payload.followBudget) } : {}),
                ...(payload.searchCount ? { DOOMSCROLL_SEARCH_COUNT: String(payload.searchCount) } : {}),
                ...(payload.seedTerms?.length ? { DOOMSCROLL_SEED_TERMS: payload.seedTerms.join(',') } : {}),
                ...(process.env.DOOMSCROLL_SEARCH_RESULT_Y ? { DOOMSCROLL_SEARCH_RESULT_Y: process.env.DOOMSCROLL_SEARCH_RESULT_Y } : {}),
            },
        }),
    };
}

function createPostTask(configuration: TikTokPluginConfiguration): TaskDefinition<PostPayload> {
    return {
        type: 'post', version: 1, displayName: 'TikTok post',
        validate(value, context) {
            const input = objectPayload(value);
            if (!Array.isArray(input.media) || input.media.length < 1 || input.media.length > MAX_POST_MEDIA) {
                throw new Error(`Choose one to ${MAX_POST_MEDIA} media files`);
            }
            const media = input.media.map((item) => {
                const candidate = objectPayload(item);
                if (typeof candidate.assetId !== 'string' || typeof candidate.name !== 'string' || typeof candidate.mimeType !== 'string') {
                    throw new Error('Invalid media item');
                }
                return { assetId: candidate.assetId, name: candidate.name, mimeType: candidate.mimeType };
            });
            if (input.destination !== 'draft' && input.destination !== 'publish') throw new Error('Invalid post destination');
            if (typeof input.account !== 'string' || !input.account.trim()) throw new Error('Choose a TikTok account');
            const caption = optionalString(input.caption, 'caption');
            if (caption && caption.length > 2200) throw new Error('Caption must be 2,200 characters or fewer');
            const musicUrl = optionalString(input.musicUrl, 'musicUrl');
            if (musicUrl) {
                const parsed = new URL(musicUrl);
                if (parsed.protocol !== 'https:' || !/(^|\.)tiktok\.com$/i.test(parsed.hostname)) {
                    throw new Error('Music URL must be an HTTPS TikTok URL');
                }
            }
            const recurring = context.timingKind === 'daily' || context.timingKind === 'weekly';
            if (recurring && input.destination === 'publish' && input.recurringPublishConfirmed !== true) {
                throw new Error('Recurring public posts require explicit confirmation');
            }
            return {
                media, destination: input.destination, account: input.account,
                ...(caption ? { caption } : {}), ...(musicUrl ? { musicUrl } : {}),
                ...(input.recurringPublishConfirmed === true ? { recurringPublishConfirmed: true } : {}),
            };
        },
        summarize: (payload) => `Post · ${payload.destination === 'publish' ? 'public' : 'draft'} · ${payload.media.length} media`,
        estimateDurationMs: () => 60_000,
        retryPolicy: () => ({ retryLimit: 0, retryDelaySeconds: 0, retryBackoff: false }),
        supportsStop: () => false,
        async execute(context: TaskExecutionContext, payload) {
            const remaining = warmupRemainingMs(context.devicePluginData, payload.account);
            if (remaining > 0) throw new Error(`${payload.account} is warming up — posting opens in ${describeRemaining(remaining)}; refusing to post`);
            const byId = new Map(context.assets.map((asset) => [asset.id, asset]));
            const files = payload.media.map((media) => {
                const asset = byId.get(media.assetId);
                if (!asset) throw new Error(`Scheduled media asset ${media.assetId} is missing`);
                return { path: asset.path, name: media.name, mimeType: media.mimeType };
            });
            const manifestPath = path.join(context.workspaceDirectory, 'manifest.json');
            await writeFile(manifestPath, JSON.stringify({
                device: context.device, files, destination: payload.destination, account: payload.account,
                ...(payload.caption ? { caption: payload.caption } : {}),
                ...(payload.musicUrl ? { musicUrl: payload.musicUrl } : {}),
            }));
            return context.runProcess({
                entrypoint: configuration.postEntrypoint ?? fileURLToPath(new URL('./tiktok/post.ts', import.meta.url)),
                args: [manifestPath],
            });
        },
    };
}

export function createTikTokPlugin(configuration: TikTokPluginConfiguration = {}): PhoneFarmPlugin {
    return {
        id: 'com.git-agni.tiktok',
        version: '0.1.0',
        displayName: 'TikTok automation',
        tasks: [createDoomscrollTask(configuration), createPostTask(configuration)],
        devicePanels: [{
            id: 'tiktok-controls', title: 'TikTok',
            fragmentPath: fileURLToPath(new URL('../static/tiktok/device-panel.html', import.meta.url)), order: 100,
        }],
        async registerRoutes(context) {
            // Operator assist: list open requests, resume or abort one.
            context.app.get('/api/assist', async () => {
                let names: string[] = [];
                try { names = (await readdir(assistDirectory())).filter((name) => name.endsWith('.json')); } catch { names = []; }
                const requests = (await Promise.all(names.map((name) => readAssist(name.replace(/\.json$/, ''))))).filter(Boolean);
                return { requests };
            });
            context.app.post<{ Params: { udid: string }; Body: { note?: string } }>('/api/assist/:udid/resume', async (request, reply) => {
                const resolved = await resolveAssist(request.params.udid, 'resume', request.body?.note);
                if (!resolved) return reply.code(404).send({ error: 'No assist request is waiting for this device' });
                return resolved;
            });
            context.app.post<{ Params: { udid: string }; Body: { note?: string } }>('/api/assist/:udid/abort', async (request, reply) => {
                const resolved = await resolveAssist(request.params.udid, 'abort', request.body?.note);
                if (!resolved) return reply.code(404).send({ error: 'No assist request is waiting for this device' });
                return resolved;
            });
            const deviceData = async (udid: string) => (await context.loadDevices()).find((device) => device.udid === udid);
            // Warm-up clock per account: while it runs, posting for that handle is refused.
            context.app.get<{ Params: { udid: string } }>('/api/devices/:udid/warmup', async (request, reply) => {
                const device = await deviceData(request.params.udid);
                if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                const map = warmupMap(device.pluginData['com.git-agni.tiktok']);
                return { warmup: Object.fromEntries(Object.entries(map).map(([handle, entry]) => [handle, { ...entry, remaining: describeRemaining(warmupRemainingMs(device.pluginData['com.git-agni.tiktok'], handle)) }])) };
            });
            context.app.post<{ Params: { udid: string }; Body: { account?: string; hours?: number; startedAt?: string } }>('/api/devices/:udid/warmup', async (request, reply) => {
                const account = request.body?.account?.trim();
                if (!account) return reply.code(400).send({ error: 'account is required' });
                const handle = (account.startsWith('@') ? account : `@${account}`).toLowerCase();
                const entry = { startedAt: request.body.startedAt ?? new Date().toISOString(), hours: request.body.hours ?? WARMUP_HOURS_DEFAULT };
                const found = await context.mutateDevices((devices) => {
                    const device = devices.find(({ udid }) => udid === request.params.udid);
                    if (!device) return false;
                    const current = device.pluginData['com.git-agni.tiktok'] ?? {};
                    const warmup = { ...((current as { warmup?: JsonObject }).warmup ?? {}), [handle]: entry };
                    device.pluginData = { ...device.pluginData, 'com.git-agni.tiktok': { ...current, warmup } };
                    return true;
                });
                if (!found) return reply.code(404).send({ error: 'Device is not registered' });
                return { account: handle, ...entry };
            });
            context.app.patch<{ Params: { udid: string }; Body: { accounts?: string[] } }>('/api/devices/:udid/accounts', async (request, reply) => {
                if (!Array.isArray(request.body.accounts)) return reply.code(400).send({ error: 'accounts must be an array' });
                const accounts = [...new Set(request.body.accounts.map((value) => value.trim()).filter(Boolean)
                    .map((value) => value.startsWith('@') ? value : `@${value}`))];
                if (accounts.some((value) => !/^@[A-Za-z0-9._]{1,64}$/.test(value))) {
                    return reply.code(400).send({ error: 'TikTok handles may contain letters, numbers, periods, and underscores' });
                }
                const found = await context.mutateDevices((devices) => {
                    const device = devices.find(({ udid }) => udid === request.params.udid);
                    if (!device) return false;
                    device.pluginData = { ...device.pluginData, 'com.git-agni.tiktok': { ...device.pluginData['com.git-agni.tiktok'], accounts } };
                    return true;
                });
                if (!found) return reply.code(404).send({ error: 'Device is not registered' });
                return { accounts };
            });

            context.app.post<{ Params: { udid: string }; Body: Record<string, string> }>(
                '/api/devices/:udid/fragments/scroll-run', async (request, reply) => {
                    const device = await deviceData(request.params.udid);
                    if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                    if (device.disabled) return reply.code(409).send({ error: 'This device is disconnected — reconnect it before scheduling automation' });
                    const body = request.body;
                    const kind = body.scheduleKind ?? 'now';
                    const timing: ScheduleTiming = kind === 'now' ? { kind: 'now' }
                        : kind === 'once' ? { kind: 'once', runAt: body.runAt ?? '' }
                            : kind === 'daily' ? { kind: 'daily', localTime: body.localTime ?? '', timezone: body.timezone ?? 'UTC' }
                                : { kind: 'weekly', localTime: body.localTime ?? '', timezone: body.timezone ?? 'UTC', weekdays: (body.weekdays ?? '').split(',').filter(Boolean).map(Number) };
                    try {
                        await context.scheduler.createTask({
                            deviceUdid: device.udid,
                            task: {
                                pluginId: 'com.git-agni.tiktok', taskType: 'doomscroll', taskVersion: 1,
                                payload: {
                                    durationMinutes: Number(body.durationMinutes), personality: body.personality,
                                    likeEnabled: body.likeEnabled === 'on', saveEnabled: body.saveEnabled === 'on',
                                    ...(body.account?.trim() ? { account: body.account.trim() } : {}),
                                    ...(body.followBudget ? { followBudget: Number(body.followBudget) } : {}),
                                    ...(body.searchCount ? { searchCount: Number(body.searchCount) } : {}),
                                    ...(body.seedTerms?.trim() ? { seedTerms: body.seedTerms.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
                                },
                            },
                            timing,
                            runWindowMinutes: body.runWindowMinutes ? Number(body.runWindowMinutes) : undefined,
                        }, device.pluginData['com.git-agni.tiktok'] ?? {});
                        return reply.code(202).type('text/html').send(await context.renderActivity(device.udid));
                    } catch (error) {
                        return reply.type('text/html').send(await context.renderActivity(device.udid, error instanceof Error ? error.message : String(error)));
                    }
                },
            );

            context.app.get<{ Params: { udid: string } }>('/api/devices/:udid/posts/current', async (request) => {
                const latest = (await context.scheduler.listExecutions(25, request.params.udid))
                    .find(({ pluginId, taskType }) => pluginId === 'com.git-agni.tiktok' && taskType === 'post');
                if (!latest) return { status: 'idle', logs: [] };
                const detail = await context.scheduler.execution(latest.id);
                return { ...latest, destination: latest.payload.destination ?? null, logs: detail?.logs ?? [] };
            });

            context.app.post<{ Params: { udid: string } }>('/api/devices/:udid/posts', async (request, reply) => {
                const device = await deviceData(request.params.udid);
                if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                if (device.disabled) return reply.code(409).send({ error: 'This device is disconnected — reconnect it before posting' });
                const dataRoot = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
                const assetRoot = path.join(dataRoot, 'assets');
                await mkdir(assetRoot, { recursive: true });
                const directory = await mkdtemp(path.join(assetRoot, 'post-'));
                const files: Array<{ path: string; name: string; mimeType: string }> = [];
                const fields = new Map<string, string>();
                let assetIds: string[] = [];
                try {
                    for await (const part of request.parts()) {
                        if (part.type === 'field') { fields.set(part.fieldname, String(part.value)); continue; }
                        if (part.fieldname !== 'media') continue;
                        const name = path.basename(part.filename || `upload-${files.length + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_');
                        const filePath = path.join(directory, `${String(files.length).padStart(2, '0')}-${name}`);
                        await pipeline(part.file, createWriteStream(filePath, { flags: 'wx' }));
                        if (part.file.truncated) throw new Error(`${name} exceeds the upload limit`);
                        files.push({ path: filePath, name, mimeType: part.mimetype });
                    }
                    if (files.length < 1 || files.length > MAX_POST_MEDIA) throw new Error(`Choose one to ${MAX_POST_MEDIA} media files`);
                    const videos = files.filter(({ mimeType }) => mimeType.startsWith('video/'));
                    const images = files.filter(({ mimeType }) => mimeType.startsWith('image/'));
                    if (!((videos.length === 1 && files.length === 1) || images.length === files.length)) {
                        throw new Error('Upload exactly one video, or upload only slideshow images');
                    }
                    const destination = fields.get('destination');
                    if (destination !== 'draft' && destination !== 'publish') throw new Error('Choose Draft or Post');
                    const account = fields.get('account')?.trim();
                    if (!account) throw new Error('Choose a TikTok account');
                    const remaining = warmupRemainingMs(device.pluginData['com.git-agni.tiktok'], account);
                    if (remaining > 0) throw new Error(`${account} is warming up — posting opens in ${describeRemaining(remaining)}`);
                    const timing = fields.has('timing') ? JSON.parse(fields.get('timing')!) as ScheduleTiming : { kind: 'now' } as const;
                    const stored = await context.scheduler.registerAssets(await Promise.all(files.map(async (file) => ({
                        relativePath: path.relative(dataRoot, file.path), originalName: file.name, mimeType: file.mimeType,
                        size: (await stat(file.path)).size,
                        sha256: await new Promise<string>((resolve, reject) => {
                            const hash = crypto.createHash('sha256');
                            createReadStream(file.path).on('data', (chunk) => hash.update(chunk)).once('error', reject).once('end', () => resolve(hash.digest('hex')));
                        }),
                    }))));
                    assetIds = stored.map(({ id }) => id);
                    const schedule = await context.scheduler.createTask({
                        deviceUdid: device.udid,
                        task: {
                            pluginId: 'com.git-agni.tiktok', taskType: 'post', taskVersion: 1,
                            payload: {
                                media: stored.map(({ id, name, mimeType }) => ({ assetId: id, name, mimeType })),
                                destination, account,
                                ...(fields.get('caption')?.trim() ? { caption: fields.get('caption')!.trim() } : {}),
                                ...(fields.get('musicUrl')?.trim() ? { musicUrl: fields.get('musicUrl')!.trim() } : {}),
                                ...(fields.get('recurringPublishConfirmed') === 'true' ? { recurringPublishConfirmed: true } : {}),
                            },
                        },
                        timing,
                        runWindowMinutes: fields.get('runWindowMinutes') ? Number(fields.get('runWindowMinutes')) : undefined,
                    }, device.pluginData['com.git-agni.tiktok'] ?? {}, new Date(), assetIds);
                    return reply.code(202).send(schedule);
                } catch (error) {
                    if (assetIds.length) await context.scheduler.deleteAssets(assetIds);
                    await rm(directory, { recursive: true, force: true });
                    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
                }
            });
        },
    };
}
