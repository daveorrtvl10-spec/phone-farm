# Phone Farm — Mac runbook (Josh)

Everything that touches a phone runs on the Mac. This repo is prepped from the VPS;
your job is the parts that need Xcode, USB, and a keychain.

## 0. Phones
Upstream ships one measured tap layout (`iphone8`: iPhone 7/8/SE 2/SE 3, 375x667).
Our fork adds `iphoneXsMax` (Xs Max / XR / 11, 414x896), **derived from the
geometry, not yet measured on a device**. Expect a calibration pass: after
registering, open the device page → calibration and nudge any tap that lands
wrong. Tell me which ones drifted and I'll fold the corrections into the profile.
Set the phone's passcode to **none** for the farm — the derived keypad rows are
the least certain numbers, and a no-passcode phone skips unlock entirely.

## 1. Xcode + pairing (once per Mac, then once per phone)
```sh
sudo xcodebuild -license accept
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -runFirstLaunch
```
- Xcode → Settings → Accounts → add your Apple ID → team **7XPVS22T62** must show.
- Plug the phone in, unlock, tap **Trust**. Xcode → Window → Devices and Simulators
  must say **Connected** (wait for it, not "Preparing").
- On the phone: Settings → Privacy & Security → **Developer Mode** → on → restart.
- Check: `xcrun xctrace list devices` lists the phone under **Devices**.

## 2. Clone + install
```sh
git clone https://github.com/daveorrtvl10-spec/phone-farm.git ~/phone-farm
cd ~/phone-farm
cp mac/env.example .env      # filled: team ID, WDA bundle id, DB creds, Xcode path
npm install
npm run appium:install-driver
```
Edit `.env` → `IOS_PLATFORM_VERSION` to the phone's iOS version (Settings → General → About).

## 3. Database (Docker Desktop must be running)
```sh
npm run db:up
npm run db:migrate
```

## 4. Build WebDriverAgent — from Terminal.app, NOT over SSH
```sh
npm run wda:prepare
```
Ends with `** TEST BUILD SUCCEEDED **`. First run: the phone shows an
"Untrusted Developer" prompt → Settings → General → VPN & Device Management →
trust the developer app, then run again.

## 5. Run
Manual (4 terminals) to see it work the first time:
```sh
npm run appium
npm run wda:service
npm run worker
npm run web
```
Open http://127.0.0.1:3000 → **Register device** → step through. Unlock the phone
when WDA first launches. After it works, make it always-on:
```sh
mac/install-agents.sh      # launchd agents, logs in ./logs/
mac/uninstall-agents.sh    # stop + remove
```

## 6. Ping me
Tell me once a device is registered and a `doomscroll` task ran. From then on the
loop is: I push, you `git pull && mac/install-agents.sh`.

## Known limits (to fix on our fork)
- `post` accepts 1–12 media files (grid math without scrolling).
- Dashboard is localhost-only by design. Don't change `WEB_HOST` without an auth plugin.


## 7. Operator access from the VPS (how Claude drives it)
Two reverse tunnels from the Mac, kept open in one Terminal tab (or the launchd
agent below):
```sh
ssh -N -R 3000:127.0.0.1:3000 -R 2222:127.0.0.1:22 j2roberts@152.53.166.111
```
- `3000` exposes the dashboard API to the VPS (screenshots, taps, posts, logs).
- `2222` exposes the Mac's SSH (Remote Login must be on) so the VPS can
  `git pull` and restart the worker without you.
Node is installed via nvm, so non-interactive shells need
`export PATH=$HOME/.nvm/versions/node/v24.0.1/bin:$PATH` before `npm`.

## Known TikTok variants (all handled in code, Sept 2026)
- Camera: CAMERA-mode (Upload bottom-left) vs POST-mode (Upload bottom-right).
- Picker: oldest-first, opens at the bottom; Next button width varies.
- Post form: single-photo (full-screen description editor) vs slideshow
  (inline keyboard; the top-left arrow leaves the form — don't tap it).
- Interstitials: "Swipe up for more", contacts prompt, avatar promo, passkey sheet,
  header tooltips. Turn TikTok → Settings → Privacy → Sync contacts OFF.
