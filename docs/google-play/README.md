# Publishing the Android app on Google Play

How the app gets from this repository to Google Play ([ADR 173](../adr/173-the-android-app-on-google-play-is-a-play-build-of-the-same-app.md)), in the order the steps are done. What is here:

| File | What |
| --- | --- |
| [listing-en.md](listing-en.md), [listing-pl.md](listing-pl.md) | The store listing texts, English and Polish |
| [console-answers.md](console-answers.md) | The answers for Play Console's App content forms: Data safety, content rating, foreground service, App access |
| [privacy.md](privacy.md) | The privacy policy (its URL goes in Play Console) |
| [delete-account.md](delete-account.md) | How an account is deleted (Play asks for this URL) |
| [graphics/](graphics/) | The 512 × 512 icon and the 1024 × 500 feature graphic, English and Polish (`make.cjs` draws them) |
| [screenshots/](screenshots/) | The phone screenshots: `raw/` as the app shows them, `en/` and `pl/` with a caption (`drive.cjs`, `caption.cjs`) |
| [png.cjs](png.cjs) | Checks each picture's size and alpha the way Play does: `node docs/google-play/png.cjs check <files>` |

## The build

- `./gradlew bundlePlay` (in `android/`) makes `app/build/outputs/bundle/play/app-play.aab`: the release build without the self-updater and without `REQUEST_INSTALL_PACKAGES` and `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, under the package name `app.botdot`.
- `android.yml` (nightly when `android/` changed, or Actions → Android → Run workflow on `main`) builds it beside the GitHub `.apk`, signs it with the release key, and keeps it 30 days as the run's **play-bundle** artifact.
- **Version:** `versionCode` is the workflow's run number and `versionName` is `0.1.<run number>`, the same as the GitHub release of that run. Each run is higher than the last, as Play requires.
- **Signing:** Play App Signing with a key Google generates. The release key CI already holds (`BOTDOT_KEYSTORE_B64`, `BOTDOT_KEYSTORE_PASSWORD` in the `release` environment) signs the bundle and becomes Play's **upload key** on the first upload. No key is ever committed.
- **Uploads:** with the secret `PLAY_SERVICE_ACCOUNT_JSON` in the `release` environment, the `play` job sends each bundle to the **internal testing** track after the tests pass (`deploy/play-upload.js`). Promoting to closed testing or production is done in Play Console.
- **Target SDK:** 36 (Android 16), what Play asks of new apps and updates since 31 August 2026.

## Steps in Play Console, in order

1. **Create the app.** Play Console → Create app. Name `botdot`, default language English (United States), App, Free. Tick the two declarations. The package name is fixed by the first upload: `app.botdot` (the GitHub app is `dev.botdot.app`).
2. **Get the first bundle.** GitHub → Actions → Android → Run workflow, branch `main`. When it is green, open the run, download **play-bundle** under Artifacts and unzip it: `app-play.aab`.
3. **First upload, by hand** (the API can't make an app's first release). Test and release → Testing → Internal testing → Create new release. When asked about app signing, keep **Use Google-generated key** (the default). Upload `app-play.aab`, Next, Save and publish.
4. **Testers.** Internal testing → Testers → Create email list with your own Google account (and anyone else's), Save. Copy the **Join on the web** link, open it on the phone, accept, install from Play.
   - The app from GitHub may stay: the Play app is a separate app (`app.botdot`) beside it. Sign in to it once.
5. **Store listing.** As the [store listing checklist](#store-listing-checklist) below says.
6. **App content.** Policy → App content: each section as [console-answers.md](console-answers.md) says (privacy policy URL, ads, app access, content rating, target audience, Data safety, foreground service with its video).
7. **Automatic uploads** (once, optional). In Google Cloud Console: a project → APIs & Services → enable **Google Play Android Developer API** → IAM → Service accounts → Create (no roles) → Keys → Add key → JSON. In Play Console → Users and permissions → Invite new users: the service account's email, App permissions → botdot → **Release to testing tracks**, Invite. In GitHub → Settings → Environments → `release` → Add secret `PLAY_SERVICE_ACCOUNT_JSON` with the whole JSON file. From then on every Android release run puts its bundle on internal testing.
8. **Closed testing** is not needed: the developer account is an organisation, so the 12 testers for 14 days that Play asks of personal accounts made after 13 November 2023 do not apply. An internal build is promoted straight to production.
9. **Reviewer access.** Google's reviewers need a server to sign in to (App access). They get a demo account on a separate demo machine, never a real one: see "Reviewers" below.
10. **Production.** Testing → promote the tested build to Production, with a staged rollout (20 %, then 100 %). Review takes up to 7 days.

## Store listing checklist

In the order Play Console shows the fields. `node docs/google-play/png.cjs check docs/google-play/graphics/*.png docs/google-play/screenshots/*/*.png` prints each picture's size and kind and exits 1, saying why, on one Play would refuse (the icon not 512 × 512 32-bit; a feature graphic not 1024 × 500 or with alpha; a screenshot not 9:16 or 16:9, a side outside 320 to 3840, or with alpha). `node test/google-play.test.js` checks the same, and the listing's lengths.

**Grow users → Store presence → Main store listing** (English, en-US, the default language)

1. **App name, Short description, Full description:** paste the three blocks of [listing-en.md](listing-en.md).
2. **App icon:** [graphics/icon-512.png](graphics/icon-512.png) (512 × 512, 32-bit PNG).
3. **Feature graphic:** [graphics/feature-1024x500.png](graphics/feature-1024x500.png) (1024 × 500, 24-bit PNG, no alpha).
4. **Video:** leave empty.
5. **Phone screenshots:** the eight of [screenshots/en/](screenshots/en/), in their order `1-home` to `8-team` (1080 × 1920, 9:16, 24-bit PNG). Without captions: [screenshots/raw/](screenshots/raw/) instead.
6. **Tablet screenshots (7-inch, 10-inch):** leave empty. The app is listed for phones; tablet pictures are optional.
7. Save.

**Grow users → Store presence → Main store listing → Manage translations → Add your own translations → Polish (pl-PL)**

8. The three text blocks of [listing-pl.md](listing-pl.md).
9. **Feature graphic:** [graphics/feature-1024x500-pl.png](graphics/feature-1024x500-pl.png).
10. **Phone screenshots:** the eight of [screenshots/pl/](screenshots/pl/), in the same order. The icon is the same in every language.
11. Save.

**Grow users → Store presence → Store settings**

12. **App category:** App, Productivity. **Tags:** as [listing-en.md](listing-en.md) says.
13. **Store listing contact details:** the email (required) is the owner's to fill in, a public address; the website is `https://botdot.app/`. The phone is optional.

**Policy → App content:** everything in [console-answers.md](console-answers.md), the privacy policy URL included.

### Making the pictures again

1. **Screenshots:** GitHub → Actions → **Play screenshots** → Run workflow, on the branch with the change. The run stages a botdot with demo data (`scene.cjs`: made-up bots, mail and contractors, no real person), starts the app on an emulator and pictures eight screens (`drive.cjs`). Download its **play-screenshots** artifact into `screenshots/raw/`.
2. **Captions:** `node docs/google-play/screenshots/caption.cjs` writes `en/` and `pl/` from `raw/`; the captions are in that file.
3. **Icon and feature graphics:** `node docs/google-play/graphics/make.cjs` (the feature graphics use `raw/1-home.png`).
4. Check them with `png.cjs check` (it fails on a picture Play would refuse), and look at each one.

## Reviewers

The app shows nothing without a botdot server, and sign-in is a passkey on that server's page, which a reviewer's test device may not keep. Play rejects an app whose reviewers can't get in. The plan: a small separate VPS (`demo.botdot.app`), one account with sample bots, and a reusable demo access code for that one account, on only when the machine is installed with `BOT_DOT_DEMO_CODE_SHA256` and never on a real machine ([ADR 216](../adr/216-managed-computers-prepare-in-the-background-and-demo-access-is-explicit.md)). Bots there run on a Claude account with a spending cap. Delete account and Sign out everywhere keep the demo account for the next reviewer (#1465). The App access answers are in [console-answers.md](console-answers.md).

## What changes the answers

A new permission, a new third party the app talks to, or a new kind of data it sends changes [console-answers.md](console-answers.md) and [privacy.md](privacy.md) in the same pull request, and the Data safety form in Play Console after it is merged.
