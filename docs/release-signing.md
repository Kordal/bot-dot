# Release signatures

Updates use ECDSA P-256 with SHA-256 and ASN.1 DER signatures, encoded as base64.
The verification key is a SubjectPublicKeyInfo DER value compiled into each client
and the server. It is never taken from the update server or its environment.

The canonical bytes are UTF-8 ASCII fields, separated by LF, with a final LF:

```
botdot-release-v1
<app>
<version>
<revision>
<file>
<sha256>
```

`app` is `mac`, `android`, `server`, or `desktop`.
`version` is a positive integer build number, without leading zeros. `revision` is
the lowercase 40-character Git revision; `sha256` is the lowercase 64-character
artifact hash. `file` is the artifact basename, or the image repository and digest.
No string contains whitespace. Clients reject a different app or an older build.
The outer `app.json` retains its existing fields and adds `release` with these five
fields and `signature`.

The production private key belongs only in the protected `release` environment's
`BOTDOT_RELEASE_PRIVATE_KEY` secret. It is never committed, sent to clients, or
placed in a container. The checked-in test key is a fixture, never a release key.

## Production trust

Provisioned on 17 October 2026. The public key is pinned in `lib/release-trust.js`
and the Swift and Kotlin `ReleaseTrust` constants. Its SHA-256
fingerprint, over the SPKI DER bytes, is:

```
cf737963a033e0626c69309360fc77a7c9715da1c0b1c5638192ff4b136e4b2d
```

The GitHub `release` environment permits deployments from the `main` branch only.
The key pair was made fresh for the public repository. The signing secret was
uploaded directly from a temporary mode-0600 file, which was then securely deleted.
No private-key backup is kept in this repository or on the workstation.

## The desktop app's update key

The desktop app (ADR 137) updates itself with Tauri's updater, which checks its own minisign signature, not the
botdot release signature above (#883). Its public key is `plugins.updater.pubkey` in
`desktop/src-tauri/tauri.conf.json`; the private key and its password are the repository secrets
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, with a copy in the owner's Mac login keychain
("botdot desktop update key"). Only the publish job of `.github/workflows/desktop-release.yml` reads them, to sign
each Mac `.app.tar.gz` and Windows installer that the manifest `latest.json` names. A lost key leaves installed apps
without updates until they are installed again with a new public key; changing it is the same: ship the new public
key in a release signed with the old one first.

## Where a release is published

An image's signed release is an index tagged `accounts-release` in its repository, whose annotation
`dev.botdot.release` is the signed manifest (`lib/registry.js`, `RELEASE_TAG`). A botdot from before accounts
reads the tag `release`, which stays at the last version without accounts: a botdot with accounts is installed
again and never offered to one as an update ([ADR 028](adr/028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)).

## The first install

`install.sh` makes the updater's own check (`lib/signed-image.js`) before it downloads an image from a
registry: it runs that file from the source the installer is in, on the Node image the Dockerfile names
(pinned by its digest), and downloads the signed digest, never the tag. A missing or wrong signature
stops the installer before any download. An image named without a registry is built on the machine and
is not checked.

The nested-Docker stage `make install-real` signs its stand-in images with the fixture key and trusts it
only in the copy of `lib/` it puts beside `install.sh` on its test machine. Nothing else chooses the key
the installer trusts.

## Fixture and rotation

The public fixture signer is rejected by the production pins. Release signers verify
their output against the compiled Node pin before publishing, so an absent secret or
a mismatched private key stops publication. Changing a release key requires updating
all three verifiers; existing clients must trust the new key before releases switch to
it. Do not replace the environment secret alone.
