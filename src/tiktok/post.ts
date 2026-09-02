import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { remote, type Browser } from 'webdriverio';

import { loadRegisteredDevices, resolveDeviceCoordinates, WdaRemoteControl } from '@git-agni/phone-farm-core';
import type { PostManifest } from './post-manifest.js';
import { type TikTokCoordinates } from './coordinates.js';
import { coordinateProfile, registeredAccounts } from './runtime-settings.js';
import { switchTikTokAccount, tapCoordinate } from './actions.js';
import { recentPickerTargets } from './post-layout.js';
import { isRedCheckboxChecked } from './pixel.js';
import { pointFromWord, recognizeWords, type OcrWord } from './ocr.js';

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
        await ensureCheckboxState(driver, remote, udid, {
            x: coordinates.useLayout.x,
            y: coordinates.useLayout.y,
        }, 'Use layout', false);
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

// The caption/post form is the only TikTok screen that shows both buttons.
function captionScreenIsOpen(words: OcrWord[]): boolean {
    return words.some((word) => wordIs(word, /^drafts?$/i)) && words.some((word) => wordIs(word, /^post$/i));
}

const ADVANCE_ATTEMPTS = 5;

// Walk picker → editor → caption form by reading the screen, not by counting
// taps. On current TikTok a single photo (Select multiple off) can jump
// straight to the editor, so a fixed picker-Next / editor-Next pair lands one
// screen early — and the editor-Next coordinate sits on top of the caption
// form's Post button. Verified the hard way on 2026-09-02.
async function advanceToCaptionScreen(
    driver: Browser, remote: WdaRemoteControl, udid: string, coordinates: TikTokCoordinates['tiktok'],
): Promise<void> {
    const { scale } = await remote.getScreenInfo(udid);
    let words: OcrWord[] = [];
    for (let attempt = 1; attempt <= ADVANCE_ATTEMPTS; attempt += 1) {
        words = await recognizeWords(await remote.getScreenshot(udid));
        if (captionScreenIsOpen(words)) {
            console.log('Caption form reached');
            return;
        }
        // "Next", "Next (3)", "Next(3)" — pick the lowest one on screen (the
        // picker/editor primary button is always at the bottom).
        const next = words.filter((word) => wordIs(word, /^next(\(\d+\))?$/i)).sort((a, b) => b.y - a.y)[0];
        if (next) {
            const point = pointFromWord(next, scale);
            await tapCoordinate(driver, point.x, point.y, `Next (OCR, step ${attempt})`);
        } else {
            const fallback = attempt === 1 ? coordinates.pickerNext : coordinates.editorNext;
            await tapCoordinate(driver, fallback.x, fallback.y, `Next (profile fallback, step ${attempt})`);
        }
        await driver.pause(3000);
    }
    const seen = words.map((word) => word.text).join(', ') || '(nothing recognized)';
    throw new Error(`Could not reach the TikTok caption form after ${ADVANCE_ATTEMPTS} steps. OCR saw: ${seen}`);
}

// Locate a caption-form button by its label and tap it. Falls back to the
// profile coordinate only when OCR cannot see the label at all.
async function tapCaptionFormButton(
    driver: Browser, remote: WdaRemoteControl, udid: string, pattern: RegExp, fallback: { x: number; y: number }, label: string,
): Promise<void> {
    const { scale } = await remote.getScreenInfo(udid);
    const words = await recognizeWords(await remote.getScreenshot(udid));
    if (!captionScreenIsOpen(words)) {
        const seen = words.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`Not on the TikTok caption form when about to tap ${label}. OCR saw: ${seen}`);
    }
    const match = words.filter((word) => wordIs(word, pattern)).sort((a, b) => b.y - a.y)[0];
    if (match) {
        const point = pointFromWord(match, scale);
        await tapCoordinate(driver, point.x, point.y, `${label} (OCR)`);
    } else {
        await tapCoordinate(driver, fallback.x, fallback.y, `${label} (profile fallback)`);
    }
}

async function addCaption(driver: Browser, coordinates: TikTokCoordinates['tiktok'], caption?: string): Promise<void> {
    if (!caption) return;
    await tapCoordinate(driver, coordinates.caption.x, coordinates.caption.y, 'caption');
    const appiumHost = process.env.APPIUM_HOST ?? '127.0.0.1';
    const appiumPort = positiveInteger('APPIUM_PORT', 4725);
    const response = await fetch(`http://${appiumHost}:${appiumPort}/session/${driver.sessionId}/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: [caption] }),
    });
    if (!response.ok) throw new Error(`Appium could not type the caption: ${await response.text()}`);
    await driver.pause(500);
    // On this TikTok screen, Back dismisses the keyboard without leaving the form.
    await tapCoordinate(driver, coordinates.keyboardBack.x, coordinates.keyboardBack.y, 'keyboard Back');
    await driver.pause(1000);
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
    await addCaption(driver, tiktokCoordinates, manifest.caption);
    if (manifest.destination === 'publish') {
        await tapCaptionFormButton(driver, deviceRemote, manifest.device.udid, /^post$/i, tiktokCoordinates.finish, 'Post');
        console.log('TikTok post submitted');
        // The upload to TikTok continues in the background after this tap —
        // tearing down the session too soon can interrupt it.
        await driver.pause(60_000);
    } else {
        await tapCaptionFormButton(driver, deviceRemote, manifest.device.udid, /^drafts?$/i, tiktokCoordinates.draft, 'Drafts');
        await driver.pause(2500);
        const after = await recognizeWords(await deviceRemote.getScreenshot(manifest.device.udid));
        if (captionScreenIsOpen(after)) {
            throw new Error('Tapped Drafts but the caption form is still open — the draft was not saved');
        }
        console.log('TikTok draft saved');
    }
} finally {
    await driver.deleteSession();
}
