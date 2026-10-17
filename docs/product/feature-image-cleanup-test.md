# Feature test: updates stop filling the disk

Test document of the feature "updates stop filling the disk" ([its record](milestone9.md#added-features), issue #254), delivered by IMG-001 and IMG-002. Nothing changes on the web page or in the Android app: what changes is which Docker images are left on the Linux machine after an update, and one line in the audit log.

## Review

The whole feature, the diff from `main`, was reviewed on `f701959` by the `kordal-reviewer` agent twice, Standards and Spec, each in a context of its own, and IMG-002's own diff by the `kordal-task-reviewer` agent, all on Claude Opus 5.5. No high finding. The fixes were reviewed once more, their diff alone, by the `kordal-task-reviewer` agent on `0f2d1d7`; its findings are fixed in `7c056e9`. Every finding and what was done about it is in IMG-002's Review.

Before the reviews, the stage in a real Docker daemon found what the unit tests could not: the cleanup listed images as `docker image ls` does, which hides an image that has a digest and no tag, and that is every image an update replaced. Nothing was removed. Fixed, with the stand-in Docker of the unit tests now hiding them too.

The task gate (2:44), the full gate (0:10) and the resilience gate (5:48, of which the stage `image-cleanup-real` 4:22) passed on `7c056e9`. The resilience gate needs a JDK: this session had none on its PATH and ran it with Android Studio's (`JAVA_HOME`).

### Follow-up

Low findings left as they are, for the owner to decide:

- **A helper that stays in `restarting`.** When the updater's script fails before it recreates the helper, the helper refuses every cleanup, and every further update, until it restarts. Older than this feature.
- **The installer waits for the cleanup without a limit of its own.** Each Docker call inside has one (5 minutes for a removal); a very long backlog keeps the installer silent after "botdot is running".
- **A pin written as `export BOT_DOT_IMAGE=…` or in quotes** is not dropped by the installer. The updater writes neither.
- **The stage repeats the updater's script** of `lib/updates.js` by hand; a change there has to be made in both.
- **Three small repetitions in `lib/updates.js` and `lib/update-install.js`:** the list of the two busy states, the repository's name from a reference, and the Mac decision made in both files.
- **Two tests that fail now and then**, of code this feature does not touch: `test/chief-message-waits.test.js` and `test/memory-recall.test.js` (IMG-001's Completion Notes). A bug for `/kordal-bug`.

### What cannot be relied on

- **Images without the release label stay.** Images downloaded before 29 September 2026 carry none. The README says how to see and remove them.
- **A second botdot on the same machine**, of the same two repositories, loses an image that none of its containers has. It downloads it again at its next start; no data is lost.
- **An image without any name** goes when it carries botdot's release label and no container has it: the label alone decides, since nothing says where it came from.
- **A bot's computer keeps its desktop image for as long as it exists**, also when it is stopped. Many computers made from different desktops keep as many images. Reset a computer, or delete the bot, and its image goes at the next update.
- **`bytes` is Docker's own total before and after.** Something else that downloads or removes images at the same moment changes the number.
- **The first update to the release that carries this** is run by the old updater. It was tested as the older updater ends it (`--record` as root); an updater older than that is not covered.
- **A Mac-hosted botdot** gets no cleanup.

## How to start it

The feature needs a Linux machine with Docker and published images, so nothing runs on this Mac for you to open. Two ways to see it:

- **Now, on this Mac:** `make image-cleanup-real` (about 4 minutes, needs Docker Desktop running). It makes one installation in a Docker daemon of its own, updates it four times and removes everything at its end. Its output names each update and its `update.cleaned` line. `IMAGE_CLEANUP_REPORT=/tmp/report.txt IMAGE_CLEANUP_STORE=containerd node tests/integration/image-cleanup-real.js` also writes `docker image ls` and `docker system df -v` before and after each update.
- **On your Linux VM, after the pull request is merged** and the images are built: the checklist below. It cannot be done before, because the VM updates only to a signed release of `main`.

## What was walked before handing over

On 2026-10-07, in a nested Docker daemon, once with Docker's classic image store and once with the containerd store, with the real `install.sh`, `compose.yaml`, server and helper:

- A first install printed "No old images to remove".
- The installer run again, to a new release, printed "Removed 1 old image" and left one server image.
- An update by the updater's own steps removed the replaced server and desktop images.
- The same with `--record` run as root, as an older updater does, removed them too: the cleanup outlives the ten seconds that updater waits.
- The installer run again on the installation those updates had pinned by digest updated it and removed the two replaced images.
- An update that failed its health check removed nothing.
- A stopped bot's computer made from the first desktop image kept that image through all of it, started, and still had its file. A running container and a stopped one of other images were untouched.
- Each cleanup wrote one `update.cleaned` line, and their `removed` numbers add up to the images that went.

## Checklist

On your Linux VM, over SSH, once the release that carries the feature is published. The first update to that release already cleans up.

| # | Do | You should see |
| --- | --- | --- |
| 1 | `docker image ls -a --digests \| grep bot-dot` and `docker system df` | The pile: several images of `ghcr.io/kordal/bot-dot` and `bot-dot-desktop`, most with `<none>` as their tag. Note the count and the size of "Images" |
| 2 | In botdot, Settings → Updates → Update | botdot restarts as before; nothing new on the screen |
| 3 | Wait a minute, then `tail -n 2 ~/bot-dot/data/audit.log` | A line `update.applied`, then `update.cleaned` with `removed` more than 0, `failed` 0 and `bytes` in the gigabytes |
| 4 | Step 1 again | One image of `bot-dot`; of `bot-dot-desktop` the new one and one for each desktop a bot's computer was made from. "Images" in `docker system df` is smaller by about the `bytes` of step 3 |
| 5 | Open a bot that has a computer and look at its screen | The computer starts, with its files and sign-ins |
| 6 | `docker ps -a` and `docker volume ls` | Every container and volume that was there before, botdot's and others |
| 7 | When the next release is out: `sh install.sh` on the VM | "botdot is running", then "Removed … old images (… GB freed)", and botdot runs the new release (Settings → Updates shows its version) |
| 8 | `sh install.sh` once more, with no new release | "No old images to remove" |

## Failure cases to try

- **An update that cannot download:** take the VM off the network and tap Update. The update fails as before, `audit.log` gets no new line, and step 1 shows the same images.
- **A cleanup that could not run:** `docker compose -f ~/bot-dot/compose.yaml stop docker-helper`, then `docker compose -f ~/bot-dot/compose.yaml exec -T --user 60000:60000 bot-dot node /opt/bot-dot/lib/update-install.js --clean`. It prints `{"removed":0,"skipped":0,"failed":1,"bytes":0}` and writes that line. Start the helper again with `docker compose -f ~/bot-dot/compose.yaml up -d`.
- **An image that is in use:** start a container from an old botdot image by hand (`docker run -d --name keepme --entrypoint sleep <old image id> infinity`) before step 2. That image is still there after the update; `docker rm -f keepme` and the next update removes it.

## What cannot be tested by hand

- **Before the merge, on the VM:** the VM takes only a signed release, and one exists only once `main` holds the feature. The stage above is the proof until then.
- **A container that appears between the inventory and a removal**, and a nameless image that is given a name in that moment: the unit tests cover both.

## Owner's acceptance

On 2026-10-07 the owner accepted the feature on commit `6210f5f` (runtime state `7c056e9`, which the three gates cover), on the strength of the stage in a real Docker daemon: the checklist above is for the Linux VM and can be done only after the merge and a release.
