# Publishing the Android app on Google Play

How the app gets from this repository to Google Play ([ADR 173](../adr/173-the-android-app-on-google-play-is-a-play-build-of-the-same-app.md)), in the order the steps are done. What is here:

| File | What |
| --- | --- |
| [listing-en.md](listing-en.md), [listing-pl.md](listing-pl.md) | The store listing texts, English and Polish |
| [console-answers.md](console-answers.md) | The answers for Play Console's App content forms: Data safety, content rating, foreground service, App access |
| [privacy.md](privacy.md) | The privacy policy (its URL goes in Play Console) |
| [delete-account.md](delete-account.md) | How an account is deleted (Play asks for this URL) |
| [graphics/](graphics/) | The 512 × 512 icon and the 1024 × 500 feature graphic (`make.cjs` draws them) |

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
5. **Store listing.** Grow users → Store presence → Main store listing: paste [listing-en.md](listing-en.md); Manage translations → add Polish → [listing-pl.md](listing-pl.md). App icon and feature graphic from [graphics/](graphics/). Phone screenshots: 2 to 8, from the app on a real phone (Play takes at most 2:1, so a tall phone screenshot is fitted onto 9:16 first). Category: Productivity. Contact email: a public address.
6. **App content.** Policy → App content: each section as [console-answers.md](console-answers.md) says (privacy policy URL, ads, app access, content rating, target audience, Data safety, foreground service with its video).
7. **Automatic uploads** (once, optional). In Google Cloud Console: a project → APIs & Services → enable **Google Play Android Developer API** → IAM → Service accounts → Create (no roles) → Keys → Add key → JSON. In Play Console → Users and permissions → Invite new users: the service account's email, App permissions → botdot → **Release to testing tracks**, Invite. In GitHub → Settings → Environments → `release` → Add secret `PLAY_SERVICE_ACCOUNT_JSON` with the whole JSON file. From then on every Android release run puts its bundle on internal testing.
8. **Closed testing** (personal developer accounts made after 13 November 2023 only). Testing → Closed testing → a track with at least 12 testers who stay opted in for 14 days in a row. Promote an internal build to it (Promote release → Closed testing). After the 14 days, Dashboard → Apply for production.
9. **Reviewer access.** Google's reviewers need a server to sign in to (App access). They get a demo account on a separate demo machine, never a real one: see "Reviewers" below.
10. **Production.** Testing → promote the tested build to Production, with a staged rollout (20 %, then 100 %). Review takes up to 7 days.

## Reviewers

The app shows nothing without a botdot server, and sign-in is a passkey on that server's page, which a reviewer's test device may not keep. Play rejects an app whose reviewers can't get in. The plan: a small separate VPS (`demo.botdot.app`), one account with sample bots, and a demo login (a fixed username and password, off unless the machine is started with it, never on a real machine) for that one account. Bots there run on a Claude account with a spending cap. The login is not built yet.

## What changes the answers

A new permission, a new third party the app talks to, or a new kind of data it sends changes [console-answers.md](console-answers.md) and [privacy.md](privacy.md) in the same pull request, and the Data safety form in Play Console after it is merged.
