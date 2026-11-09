# ADR-172: The Android app on Google Play is a play build of the same app

- **Status:** Accepted (2026-11-09, the owner asked to release the app on Google Play)
- **Owning task:** the owner's request to publish the Android app on Google Play
- **Builds on:** [ADR 0001](0001-native-apps-per-platform.md) (a native app per platform)

## Context

The Android app is released as a signed `.apk` on GitHub and carried by the server image, and it updates itself from the botdot server it is signed in to. Google Play takes an Android App Bundle (`.aab`), updates apps itself, and restricts two permissions the app asks for: `REQUEST_INSTALL_PACKAGES` (installing other apps, which the self-updater needs) and `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (asking Android to exempt the app from the battery saver). An app on Play that installs its own updates from elsewhere breaks Play's rules.

## Decision

- **A `play` build type, beside `release`.** It starts from `release` (minified, the same signing key, the same baseline profile) and differs only in two things: `BuildConfig.SELF_UPDATE` is false, so the app never offers the server's newer app (`AppUpdate.newer`), and `src/play/AndroidManifest.xml` removes the two restricted permissions. Without the battery permission the app opens Android's battery list (`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`) instead of the exemption prompt. Same `applicationId` (`dev.botdot.app`), same code, same tests.
- **The release run builds both.** `android.yml` runs `assembleRelease bundlePlay`, checks that the bundle is signed with the release key and asks for neither permission, keeps it 30 days as the run's `play-bundle` artifact, and, when the `release` environment has `PLAY_SERVICE_ACCOUNT_JSON`, sends it to Play's **internal** testing track after the tests pass (`deploy/play-upload.js`, the Play Developer API, no dependencies). Promoting a build to closed testing or production stays a step in Play Console. The `versionCode` is the run number, so every bundle is newer than the last.
- **The release key is Play's upload key.** Play App Signing re-signs what reaches phones with an app signing key Google generates and keeps. CI signs the bundle with the key it already holds (`BOTDOT_KEYSTORE_B64`), which Play registers as the upload key on the first upload. No new secret is needed to build.
- **GitHub stays a channel.** Self-hosters keep the `.apk` on GitHub and the self-updater. A phone with one cannot update to the other: the two are signed by different keys, so switching means uninstalling once. Sign-in goes through the browser, so it does not depend on the signing certificate.

## Alternatives

- **Product flavors (`github` and `play`):** every task name changes (`testDebugUnitTest` becomes `testGithubDebugUnitTest`, the emulator, lint and baseline profile tasks too), across CI, the Makefile and the docs, for a difference of one flag and two manifest lines.
- **Upload the existing release key to Play App Signing (PEPK):** Play and GitHub installs would update each other, but it needs the keystore on the owner's computer and Google's encryption tool, cannot be undone, and moves the key that signs every GitHub release into Google's hands as well. Switching channels is rare.
- **Only Play, no GitHub `.apk`:** the self-hosters who don't use Play, or install on devices without it, would lose the app.

## Consequences

- A Play install and a GitHub install of the app are not updates of each other.
- A release builds the app twice (about two more minutes).
- The Play listing, privacy policy and Play Console answers live in `docs/google-play/` and must follow the app: a new permission or a new kind of data sent anywhere changes the Data safety answers.
