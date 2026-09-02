import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { remote, type Browser } from 'webdriverio';

import { loadRegisteredDevices, resolveDeviceCoordinates, WdaRemoteControl } from '@git-agni/phone-farm-core';
import type { PostManifest } from './post-manifest.js';
import { type TikTokCoordinates } from './coordinates.js';
import { coordinateProfile, registeredAccounts } from './runtime-settings.js';
import { switchTikTokAccount, tapCoordinate } from './actions.js';
import { recentPickerTargets } from './post-layout.js';
import { isRedCheckboxChecked } from './pixel.js';
import { recognizeWords, type OcrWord } from './ocr.js';

function positiveInteger(name: string, fallback: number): number {
    const raw = process.env[name] ?? String(fallback);
    const value = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
    return value;
}

async function importMedia(manifest: PostManifest): Promise<number> {
    const wdaUrl = process.env.WDA_URL ?? 'http://127.0.0.1:8100';
    let assetCount = 0;
    // Photos Recents is newest-first. Reverse import makes cell 0 the user's first item.
    for (const [index, file] of [...manifest.files].reverse().entries()) {
        console.log(`Importing media ${manifest.files.length - index}/${manifest.files.length}: ${file.name}`);
        const data = await readFile(file.path);
        // WDA's /wda/import-media takes the whole file base64-encoded in a JSON
        // body. base64 is 4*ceil(n/3) chars and JSON.stringify allocates a
        // second copy; Node's max string length (~512 MiB) caps the input near
        // 384 MiB, so refuse well before that.
        if (data.length > 350 * 1024 * 1024) {
            throw new Error(`${file.name} is ${(data.length / 1_048_576).toFixed(0)} MB — the TikTok media import limit is 350 MB`);
        }
        const response = await fetch(`${wdaUrl}/wda/import-media`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: file.name, mimeType: file.mimeType, data: data.toString('base64') }),
        });
        const result = await response.json() as { value?: { error?: unknown; assetCount?: number } };
        if (!response.ok || (result.value && typeof result.value === 'object' && 'error' in result.value)) {
            throw new Error(`WDA could not import ${file.name}: ${JSON.stringify(result)}`);
        }
        assetCount = result.value?.assetCount ?? 0;
    }
    if (!assetCount) throw new Error('WDA did not return the Photos asset count');
    return assetCount;
}

async function firstDisplayed(driver: Browser, selectors: string[]) {
    for (const selector of selectors) {
        const candidate = await driver.$(selector);
        if (await candidate.isExisting() && await candidate.isDisplayed()) return candidate;
    }
    return undefined;
}

async function clickOne(driver: Browser, label: string, selectors: string[]): Promise<void> {
    const element = await firstDisplayed(driver, selectors);
    if (!element) throw new Error(`TikTok control not found: ${label}`);
    await element.click();
    console.log(`Tapped ${label}`);
}

async function openComposer(
    driver: Browser,
    coordinates: TikTokCoordinates['tiktok'],
    musicUrl?: string,
): Promise<void> {
    if (musicUrl) {
        console.log(`Opening music URL: ${musicUrl}`);
        await driver.execute('mobile: deepLink', { url: musicUrl });
        await driver.pause(4000);
        await clickOne(driver, 'Use this sound', [
            '~Use this sound', '~Use sound', '-ios predicate string:(label CONTAINS[c] "Use this sound") OR (name CONTAINS[c] "Use this sound")',
        ]);
    } else {
        await driver.activateApp(process.env.TIKTOK_BUNDLE_ID ?? 'com.zhiliaoapp.musically');
        await driver.pause(2500);
        // TikTok's live feed can make accessibility queries hang. The center
        // bottom navigation button is stable on the configured device layout.
        await tapCoordinate(
            driver,
            coordinates.create.x,
            coordinates.create.y,
            'Create',
        );
    }
    await driver.pause(2500);
    await tapCoordinate(driver, coordinates.upload.x, coordinates.upload.y, 'Upload');
    await driver.pause(2500);
}

const CHECKBOX_RETRY_ATTEMPTS = 3;

// TikTok's Photos picker checkboxes ("Select multiple", "Use layout") are
// persistent toggles, not one-time buttons — they can already be in the
// desired state from a previous picker session. A blind tap assuming a
// fixed starting state can flip a checkbox the WRONG way (e.g. turning off
// an already-on "Select multiple", silently dropping into single-select
// mode). Check the actual on-screen color before deciding whether to tap.
async function ensureCheckboxState(
    driver: Browser,
    remote: WdaRemoteControl,
    udid: string,
    point: { x: number; y: number },
    label: string,
    desired: boolean,
): Promise<void> {
    const { scale } = await remote.getScreenInfo(udid);
    for (let attempt = 1; attempt <= CHECKBOX_RETRY_ATTEMPTS; attempt += 1) {
        const checked = await isRedCheckboxChecked(await remote.getScreenshot(udid), point, scale);
        if (checked === desired) {
            console.log(`"${label}" confirmed ${desired ? 'on' : 'off'}`);
            return;
        }
        await tapCoordinate(driver, point.x, point.y, `${label} (attempt ${attempt})`);
        await driver.pause(1000);
    }
    throw new Error(`Could not get "${label}" into the ${desired ? 'on' : 'off'} state after ${CHECKBOX_RETRY_ATTEMPTS} attempts`);
}

async function chooseRecentMedia(
    driver: Browser, remote: WdaRemoteControl, udid: string, count: number, assetCount: number,
    coordinates: TikTokCoordinates['tiktok'],
): Promise<void> {
    const latestIndex = assetCount - 1;
    await requireScreen(remote, udid, 'picker', 'Opening the photo picker');
    if (count > 1) {
        await ensureCheckboxState(driver, remote, udid, {
            x: coordinates.selectMultiple.x,
            y: coordinates.selectMultiple.y,
        }, 'Select multiple', true);
        const targets = recentPickerTargets(assetCount, count, {
            circleX: coordinates.picker.circleX,
            columnStep: coordinates.picker.columnStep,
            firstY: coordinates.picker.firstY,
            trayY: coordinates.picker.trayY,
            rowStep: coordinates.picker.rowStep,
            newestFirst: coordinates.picker.newestFirst,
        });
        for (const [selection, { x, y }] of targets.entries()) {
            await tapCoordinate(driver, x, y, `media ${selection + 1}/${count}`);
            await driver.pause(600);
        }
        // "Use layout" only appears once 2+ items are ticked; it defaults off.
        if (has(await screenWords(remote, udid), /^layout$/i)) {
            await ensureCheckboxState(driver, remote, udid, {
                x: coordinates.useLayout.x,
                y: coordinates.useLayout.y,
            }, 'Use layout', false);
        } else {
            console.log('"Use layout" not shown; skipping');
        }
    } else {
        const column = coordinates.picker.newestFirst ? 0 : latestIndex % 3;
        const x = coordinates.picker.cellX + (column * coordinates.picker.cellStep);
        await tapCoordinate(driver, x, coordinates.picker.cellY, 'media 1/1');
        await driver.pause(1000);
    }
    await advanceToCaptionScreen(driver, remote, udid, coordinates);
}

function wordIs(word: OcrWord, pattern: RegExp): boolean {
    return pattern.test(word.text.trim());
}
function has(words: OcrWord[], pattern: RegExp): boolean {
    return words.some((word) => wordIs(word, pattern));
}

// Screen signatures, from readable words only. OCR cannot read white-on-red
// buttons (Next, Post) or the icon+label Drafts button, so those are tapped at
// profile coordinates and the *screen* is identified by its other labels.
// Mapped live on an Xs Max, TikTok Sept 2026.
type PostScreen = 'picker' | 'preview' | 'editor' | 'form' | 'captionEditor' | 'unknown';
function identifyScreen(words: OcrWord[]): PostScreen {
    const location = has(words, /^location$/i);
    const share = has(words, /^share$/i);
    const catchy = has(words, /^catchy$/i) || has(words, /^description$/i);
    if (location && share) return 'form';                      // caption/post form
    if (catchy && has(words, /^\d+\/4000$/)) return 'captionEditor'; // full-screen text editor
    if (has(words, /^recents$/i) || (has(words, /^select$/i) && has(words, /^multiple$/i))) return 'picker';
    if (has(words, /^autocut$/i)) return 'preview';             // single-photo full-screen preview
    if (has(words, /^sound$/i) || has(words, /^story$/i)) return 'editor';
    return 'unknown';
}

async function screenWords(remote: WdaRemoteControl, udid: string): Promise<OcrWord[]> {
    return recognizeWords(await remote.getScreenshot(udid));
}

async function saveShot(remote: WdaRemoteControl, udid: string, name: string): Promise<string> {
    const file = path.resolve('.wda', `${name}-${udid}.png`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await remote.getScreenshot(udid));
    return file;
}

const ADVANCE_ATTEMPTS = 8;

// Walk picker → (preview) → editor → form by reading the screen, not by
// counting taps. A single photo opens a full-screen preview first; multiple
// photos go straight to the editor. The old fixed picker-Next/editor-Next pair
// landed one screen early and its editor-Next coordinate sits on the form's
// Post button. Verified the hard way on 2026-09-02.
async function advanceToCaptionScreen(
    driver: Browser, remote: WdaRemoteControl, udid: string, coordinates: TikTokCoordinates['tiktok'],
): Promise<void> {
    let words: OcrWord[] = [];
    let screen: PostScreen = 'unknown';
    for (let attempt = 1; attempt <= ADVANCE_ATTEMPTS; attempt += 1) {
        words = await screenWords(remote, udid);
        screen = identifyScreen(words);
        if (screen === 'form') {
            console.log('Caption form reached');
            return;
        }
        if (screen === 'picker' || screen === 'preview') {
            await tapCoordinate(driver, coordinates.pickerNext.x, coordinates.pickerNext.y, `Next on ${screen}`);
            await driver.pause(3500);
        } else if (screen === 'editor') {
            await tapCoordinate(driver, coordinates.editorNext.x, coordinates.editorNext.y, 'Next on editor');
            await driver.pause(3500);
        } else {
            // Transition still rendering — look again before touching anything.
            console.log(`Screen not recognised yet (step ${attempt}); waiting`);
            await driver.pause(1500);
        }
    }
    const file = await saveShot(remote, udid, 'caption-form-unreached');
    const seen = words.map((word) => word.text).join(', ') || '(nothing recognized)';
    throw new Error(`Could not reach the TikTok caption form after ${ADVANCE_ATTEMPTS} steps (last screen: ${screen}). Screenshot saved to ${file}. OCR saw: ${seen}`);
}

async function requireScreen(remote: WdaRemoteControl, udid: string, expected: PostScreen, label: string): Promise<OcrWord[]> {
    const words = await screenWords(remote, udid);
    const screen = identifyScreen(words);
    if (screen !== expected) {
        const file = await saveShot(remote, udid, `expected-${expected}`);
        const seen = words.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`${label}: expected the ${expected} screen but saw ${screen}. Screenshot saved to ${file}. OCR saw: ${seen}`);
    }
    return words;
}

async function addCaption(
    driver: Browser, remote: WdaRemoteControl, udid: string, coordinates: TikTokCoordinates['tiktok'], caption?: string,
): Promise<void> {
    if (!caption) return;
    // `caption` is the description field on the post form; tapping it opens a
    // full-screen text editor with the keyboard up.
    await tapCoordinate(driver, coordinates.caption.x, coordinates.caption.y, 'description field');
    await driver.pause(1500);
    await requireScreen(remote, udid, 'captionEditor', 'Opening the description editor');
    const appiumHost = process.env.APPIUM_HOST ?? '127.0.0.1';
    const appiumPort = positiveInteger('APPIUM_PORT', 4725);
    const response = await fetch(`http://${appiumHost}:${appiumPort}/session/${driver.sessionId}/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: [caption] }),
    });
    if (!response.ok) throw new Error(`Appium could not type the caption: ${await response.text()}`);
    await driver.pause(800);
    // The editor's top-left back arrow returns to the form with the text kept.
    // (Its top-right button is Post — never tap anything else up there.)
    await tapCoordinate(driver, coordinates.keyboardBack.x, coordinates.keyboardBack.y, 'editor back');
    await driver.pause(1500);
    await requireScreen(remote, udid, 'form', 'Returning from the description editor');
    console.log('Caption added');
}

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('A post manifest path is required');
const manifest = JSON.parse(await readFile(path.resolve(manifestPath), 'utf8')) as PostManifest;

const switchAccountName = manifest.account?.trim() || undefined;
const registeredDevice = (await loadRegisteredDevices()).find((device) => device.udid === manifest.device.udid);
const coordinates = resolveDeviceCoordinates(coordinateProfile(registeredDevice), registeredDevice?.coordinates);
const tiktokCoordinates = coordinates.tiktok;
const accountSwitchCoords = {
    profileTabX: tiktokCoordinates.profileTab.x,
    profileTabY: tiktokCoordinates.profileTab.y,
    switcherTriggerX: tiktokCoordinates.accountSwitcher.x,
    switcherTriggerY: tiktokCoordinates.accountSwitcher.y,
    swipe: tiktokCoordinates.swipe,
};
// Fail fast, before unlocking or launching TikTok, if the requested account
// isn't one this device is registered for.
const allowedAccounts = switchAccountName
    ? registeredAccounts(registeredDevice)
    : [];
if (switchAccountName && !allowedAccounts.includes(switchAccountName)) {
    throw new Error(`TikTok account "${switchAccountName}" is not listed in devices.json for device ${manifest.device.udid}`);
}

const deviceRemote = new WdaRemoteControl({
    deviceUdid: manifest.device.udid,
    passcodeKeypadLayout: coordinates.passcodeKeypad,
});
console.log('Checking device lock state');
await deviceRemote.unlock(manifest.device.udid);

const assetCount = await importMedia(manifest);

const bundleId = process.env.TIKTOK_BUNDLE_ID ?? 'com.zhiliaoapp.musically';
const capabilities: WebdriverIO.Capabilities & Record<string, unknown> = {
    platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': manifest.device.udid,
    'appium:bundleId': bundleId, 'appium:noReset': true, 'appium:forceAppLaunch': true,
    'appium:shouldTerminateApp': true, 'appium:newCommandTimeout': 180,
    'appium:waitForIdleTimeout': 0,
};
if (process.env.WDA_URL) {
    capabilities['appium:webDriverAgentUrl'] = process.env.WDA_URL;
    capabilities['appium:wdaRemotePort'] = positiveInteger('WDA_REMOTE_PORT', 8100);
}

// The composer/picker flow (up to the caption screen) is the fragile part —
// flaky picker checkboxes, transient tooltips, TikTok UI timing — so it gets
// retried with a fresh app relaunch on failure. Caption entry and the final
// Post/Drafts tap are NOT retried: retrying after that risks a duplicate
// post or draft, which is worse than a single clean failure.
const REACH_CAPTION_SCREEN_ATTEMPTS = 3;
let driver: Browser | undefined;
let reachedCaptionScreen = false;
let lastAttemptError: unknown;

for (let attempt = 1; attempt <= REACH_CAPTION_SCREEN_ATTEMPTS && !reachedCaptionScreen; attempt += 1) {
    if (attempt > 1) {
        console.log(`Retrying up to the caption screen (attempt ${attempt}/${REACH_CAPTION_SCREEN_ATTEMPTS})`);
    }
    try {
        driver = await remote({ hostname: process.env.APPIUM_HOST ?? '127.0.0.1', port: positiveInteger('APPIUM_PORT', 4725), path: '/', logLevel: 'info', connectionRetryCount: 0, connectionRetryTimeout: 180000, capabilities });
        await driver.updateSettings({ defaultActiveApplication: bundleId });
        // Foreground TikTok before any tap. Seen live: the phone was sitting on
        // an Apple Music welcome screen, so the Profile-tab tap landed in the
        // wrong app and the account check failed twice before a retry happened
        // to find TikTok in front.
        await driver.activateApp(bundleId);
        await driver.pause(2500);
        if (switchAccountName) {
            console.log(`Switching to TikTok account "${switchAccountName}"`);
            await switchTikTokAccount(driver, deviceRemote, manifest.device.udid, switchAccountName, accountSwitchCoords);
        }
        await openComposer(driver, tiktokCoordinates, manifest.musicUrl);
        await chooseRecentMedia(driver, deviceRemote, manifest.device.udid, manifest.files.length, assetCount, tiktokCoordinates);
        reachedCaptionScreen = true;
    } catch (error) {
        lastAttemptError = error;
        console.error(`Attempt ${attempt}/${REACH_CAPTION_SCREEN_ATTEMPTS} failed before reaching the caption screen: ${error instanceof Error ? error.message : String(error)}`);
        if (driver) {
            await driver.deleteSession().catch(() => {});
            driver = undefined;
        }
    }
}

if (!reachedCaptionScreen || !driver) {
    throw lastAttemptError instanceof Error
        ? lastAttemptError
        : new Error(`Could not reach the TikTok caption screen after ${REACH_CAPTION_SCREEN_ATTEMPTS} attempts`);
}

try {
    await addCaption(driver, deviceRemote, manifest.device.udid, tiktokCoordinates, manifest.caption);
    await requireScreen(deviceRemote, manifest.device.udid, 'form', 'Before submitting');
    if (manifest.destination === 'publish') {
        await tapCoordinate(driver, tiktokCoordinates.finish.x, tiktokCoordinates.finish.y, 'Post');
        console.log('TikTok post submitted');
        // The upload to TikTok continues in the background after this tap —
        // tearing down the session too soon can interrupt it.
        await driver.pause(60_000);
    } else {
        await tapCoordinate(driver, tiktokCoordinates.draft.x, tiktokCoordinates.draft.y, 'Drafts');
        await driver.pause(3000);
        const after = identifyScreen(await screenWords(deviceRemote, manifest.device.udid));
        if (after === 'form' || after === 'captionEditor') {
            const file = await saveShot(deviceRemote, manifest.device.udid, 'draft-not-saved');
            throw new Error(`Tapped Drafts but the post form is still open — the draft was not saved. Screenshot saved to ${file}`);
        }
        console.log('TikTok draft saved');
    }
} finally {
    await driver.deleteSession();
}
