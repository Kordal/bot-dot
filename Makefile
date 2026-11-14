# Development commands.

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show available commands
	@grep -E '^[a-zA-Z0-9_.-]+:.*## ' "$(firstword $(MAKEFILE_LIST))" | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-16s %s\n", $$1, $$2}'

.PHONY: lint
lint: ## Check the documentation links, that the code parses, that the styles keep to the scales, and the types of the files marked @ts-check
	@if command -v node >/dev/null 2>&1; then ./tests/integration/check-docs.sh && node scripts/check-code.js && node scripts/check-css-tokens.js && ./scripts/typecheck.sh; else echo "check-docs.sh, check-code.js, check-css-tokens.js and typecheck.sh skipped: they need a local Node.js"; fi

.PHONY: test
test: ## Run the tests that need nothing running
	npm test

# The Android checks of .github/workflows/tests.yml, one target per step, with the
# same commands; android-build is local only (CI's tests and lint compile the app).
# A target whose tool is missing fails saying which one.

.PHONY: android-tools
android-tools:
	@if [ -n "$$JAVA_HOME" ]; then "$$JAVA_HOME/bin/java" -version; else java -version; fi >/dev/null 2>&1 \
		|| { echo "Java is missing: the Android targets need a JDK (CI uses 21) on PATH or in JAVA_HOME"; exit 1; }
	@sdk=$$(sed -n 's/^sdk\.dir=//p' android/local.properties 2>/dev/null); \
		[ -n "$$sdk" ] || sdk="$${ANDROID_HOME:-$$ANDROID_SDK_ROOT}"; \
		[ -n "$$sdk" ] && [ -d "$$sdk" ] \
		|| { echo "The Android SDK is missing: the Android targets need it as sdk.dir in android/local.properties or in ANDROID_HOME"; exit 1; }

.PHONY: android-build
android-build: android-tools ## Build the Android app
	cd android && ./gradlew assembleDebug --console=plain

.PHONY: android-test
android-test: android-tools ## Run the Android app's unit tests and the shared data layer's (ADR 242)
	cd android && ./gradlew testDebugUnitTest :shared:testAndroidHostTest --console=plain

.PHONY: android-lint
android-lint: android-tools ## Lint the Android app; known problems are in app/lint-baseline.xml
	cd android && ./gradlew lintDebug --console=plain

# The desktop app (ADR 137). A target whose tool is missing fails saying which one.
.PHONY: desktop-tools
desktop-tools:
	@command -v cargo >/dev/null 2>&1 || { echo "Rust is missing: the desktop targets need cargo (https://rustup.rs)"; exit 1; }
	@cargo tauri --version >/dev/null 2>&1 || { echo "The Tauri command is missing: cargo install tauri-cli --version '^2' --locked"; exit 1; }

.PHONY: desktop-build
desktop-build: desktop-tools ## Build the desktop app for this computer
	cd desktop/src-tauri && cargo tauri build --bundles $(if $(filter Windows_NT,$(OS)),nsis,app)

.PHONY: desktop-test
desktop-test: desktop-tools ## Run the desktop app's tests
	cd desktop/src-tauri && cargo test

.PHONY: desktop-lint
desktop-lint: desktop-tools ## Lint the desktop app as CI does
	cd desktop/src-tauri && cargo clippy --locked --all-targets -- -D warnings

# A self-built botdot server (CONTEXT.md): both images from this source, named without a registry, which
# install.sh then installs without a token or a download. SERVER_IMAGE and COMPUTER_IMAGE rename them. The label
# dev.botdot.self-built marks them, so make staging can find a nameless one an earlier build left (deploy/staging.sh).
SERVER_IMAGE ?= bot-dot/server:latest
COMPUTER_IMAGE ?= bot-dot/desktop:latest
.PHONY: images
images: ## Build botdot's server image and the bots' computer image from this source, for a self-built botdot server (needs Docker)
	docker build -t "$(SERVER_IMAGE)" --label dev.botdot.self-built=true --label "org.opencontainers.image.revision=$$(git rev-parse HEAD 2>/dev/null || true)" .
	docker build -t "$(COMPUTER_IMAGE)" --label dev.botdot.self-built=true deploy/desktop

# A staging botdot server moved to another branch (deploy/staging.sh, docs/install-linux.md).
.PHONY: staging
staging: ## Move a self-built staging server to branch REF: check the disk, fetch, checkout, pull, make images, install.sh, then keep the running and the previous image and trim the build cache (needs Docker)
	@SERVER_IMAGE="$(SERVER_IMAGE)" COMPUTER_IMAGE="$(COMPUTER_IMAGE)" MAKE="$(MAKE)" sh deploy/staging.sh "$(REF)"

.PHONY: tools-real
tools-real: ## The real micromamba installs jq from conda-forge for one bot both ways, under the container's restrictions (needs Docker and the network)
	@./tests/integration/tools-real.sh

.PHONY: install-real
install-real: ## A first install with today's installer and images from a local registry, in a nested Docker daemon: botdot answers, a bot's computer starts and stops (needs Docker and the network)
	@./tests/integration/install-real.sh

.PHONY: install-prereqs
install-prereqs: ## install.sh's first step on a fresh Ubuntu, Debian, Fedora, Rocky and AlmaLinux machine, with the real packages: Docker, rootless Docker and gVisor at its pinned release (INSTALL_PREREQS_DISTRO picks one; needs Docker and the network)
	@./tests/integration/install-prereqs.sh

.PHONY: accounts-real
accounts-real: ## Two accounts on one machine, in a nested Docker daemon: a sign-up link from the admin page makes the second, and neither account's bot, user or Docker reaches the other's containers, data or socket, nor its session the other; then the admin suspends, resumes and deletes the second, which leaves nothing of it on the machine, and a sign-in link gives it a new passkey; each account's share applies: its own disk, its one computer sized by its CPU and RAM, a full disk is marked (needs Docker and the network)
	@./tests/integration/accounts-real.sh

.PHONY: gvisor-real
gvisor-real: ## ADR 028's spike: one account's real botdot and bot's computer in a rootless Docker under gVisor, its identity check, desktop, Camoufox and footprint (needs Docker and the network)
	@./tests/integration/gvisor-real.sh

.PHONY: image-cleanup-real
image-cleanup-real: ## Three updates of a machine of two accounts in a nested Docker daemon, by install.sh and by the admin page: the front door and both accounts run the new release, no Docker keeps an unused botdot image, a stopped computer and other workloads stay, an unsigned release is refused (needs Docker and the network)
	@./tests/integration/image-cleanup-real.sh
