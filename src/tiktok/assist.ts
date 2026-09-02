import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Pause-and-wait for a human operator.
 *
 * When an automation step cannot recognise the screen after its retries it
 * does NOT fail: it writes an assist request, holds the Appium session open and
 * polls for a resume. The dashboard unlocks remote input for that device while a
 * request is open, so the operator can tap the phone back to a known screen,
 * then POST /api/assist/:udid/resume. The step re-reads the screen and carries
 * on. If nobody resumes within the timeout the run fails with the screenshot
 * kept. Requests are files so the worker's child process (which raises them)
 * and the web server (which answers them) need no shared runtime.
 */
export interface AssistRequest {
    udid: string;
    state: 'waiting' | 'resume' | 'abort';
    reason: string;
    step: string;
    screenshotPath?: string;
    ocr?: string;
    requestedAt: string;
    resolvedAt?: string;
    note?: string;
}

export function assistDirectory(): string {
    return path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data', 'assist');
}

export function assistPath(udid: string): string {
    return path.join(assistDirectory(), `${udid}.json`);
}

export async function readAssist(udid: string): Promise<AssistRequest | undefined> {
    try {
        return JSON.parse(await readFile(assistPath(udid), 'utf8')) as AssistRequest;
    } catch {
        return undefined;
    }
}

export async function writeAssist(request: AssistRequest): Promise<void> {
    await mkdir(assistDirectory(), { recursive: true });
    await writeFile(assistPath(request.udid), JSON.stringify(request, null, 2));
}

export async function clearAssist(udid: string): Promise<void> {
    await rm(assistPath(udid), { force: true });
}

export async function resolveAssist(udid: string, state: 'resume' | 'abort', note?: string): Promise<AssistRequest | undefined> {
    const current = await readAssist(udid);
    if (!current || current.state !== 'waiting') return undefined;
    const resolved: AssistRequest = { ...current, state, resolvedAt: new Date().toISOString(), ...(note ? { note } : {}) };
    await writeAssist(resolved);
    return resolved;
}

export const ASSIST_TIMEOUT_MS = Number(process.env.ASSIST_TIMEOUT_MINUTES ?? 30) * 60_000;
const POLL_MS = 5_000;

/**
 * Raise a request and block until the operator resumes. Resolves on resume;
 * throws on abort or timeout. The caller must re-read the screen afterwards.
 */
export async function awaitAssist(
    request: Omit<AssistRequest, 'state' | 'requestedAt'>,
    options: { timeoutMs?: number; pause?: (ms: number) => Promise<void> } = {},
): Promise<AssistRequest> {
    const timeoutMs = options.timeoutMs ?? ASSIST_TIMEOUT_MS;
    const pause = options.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const requested: AssistRequest = { ...request, state: 'waiting', requestedAt: new Date().toISOString() };
    await writeAssist(requested);
    console.log(`ASSIST NEEDED [${request.step}]: ${request.reason}${request.screenshotPath ? ` (screenshot ${request.screenshotPath})` : ''}`);
    const deadline = Date.now() + timeoutMs;
    try {
        while (Date.now() < deadline) {
            await pause(POLL_MS);
            const current = await readAssist(request.udid);
            if (!current) throw new Error(`Assist request for ${request.udid} disappeared while waiting`);
            if (current.state === 'resume') {
                console.log(`Assist resumed by operator${current.note ? `: ${current.note}` : ''}`);
                return current;
            }
            if (current.state === 'abort') {
                throw new Error(`Aborted by operator${current.note ? `: ${current.note}` : ''}`);
            }
        }
        throw new Error(`No operator resumed within ${Math.round(timeoutMs / 60_000)} minutes (${request.step}: ${request.reason})`);
    } finally {
        await clearAssist(request.udid);
    }
}
