# Development commands.

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show available commands
	@grep -E '^[a-zA-Z0-9_.-]+:.*## ' "$(firstword $(MAKEFILE_LIST))" | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-16s %s\n", $$1, $$2}'

.PHONY: lint
lint: ## Check the documentation links
	@if command -v node >/dev/null 2>&1; then ./tests/integration/check-docs.sh; else echo "check-docs.sh skipped: it needs a local Node.js"; fi

.PHONY: test
test: ## Run the tests that need nothing running
	npm test

# The Android checks of .github/workflows/tests.yml, one target per step, with the
# same commands; android-build is local only (CI's tests and lint compile the app).
# A target whose tool is missing fails saying which one.
# mac-build and mac-test build and test the stopped Mac app (ADR 031) on a Mac; no
# workflow runs them. Where the full Xcode is installed and not selected, they use
# it from /Applications.

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
android-test: android-tools ## Run the Android app's unit tests
	cd android && ./gradlew testDebugUnitTest --console=plain

.PHONY: android-lint
android-lint: android-tools ## Lint the Android app; known problems are in app/lint-baseline.xml
	cd android && ./gradlew lintDebug --console=plain

ifeq ($(origin DEVELOPER_DIR),undefined)
ifneq ($(wildcard /Applications/Xcode.app/Contents/Developer),)
ifneq ($(shell xcodebuild -version >/dev/null 2>&1 && echo ok),ok)
export DEVELOPER_DIR := /Applications/Xcode.app/Contents/Developer
endif
endif
endif

.PHONY: mac-tools
mac-tools:
	@xcodebuild -version >/dev/null 2>&1 \
		|| { echo "Xcode is missing: the Mac targets need the full Xcode, not only its command line tools (xcode-select, or DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer)"; exit 1; }

# The output goes to macos/build, which Git ignores.
.PHONY: mac-build
mac-build: mac-tools ## Build the Mac app
	xcodebuild -project macos/BotDot.xcodeproj -scheme BotDot -configuration Debug -derivedDataPath macos/build build -quiet

.PHONY: mac-test
mac-test: mac-tools ## Test the Mac app's data layer (BotDotKit) against real botdot test servers
	@command -v node >/dev/null 2>&1 \
		|| { echo "Node.js is missing: the BotDotKit tests start botdot test servers with it"; exit 1; }
	cd macos/BotDotKit && swift test

# The Mac app is not released: the owner's Mac gets it from here. APPLICATIONS is the folder it
# goes to. Without a selected Xcode it uses the one in /Applications (macos/install.sh).
APPLICATIONS ?= /Applications
.PHONY: mac-install
mac-install: ## Build the Mac app and put it in Applications in place of the one there, then open it
	@./macos/install.sh "$(APPLICATIONS)"

# A self-built botdot server (CONTEXT.md): both images from this source, named without a registry, which
# install.sh then installs without a token or a download. SERVER_IMAGE and COMPUTER_IMAGE rename them.
SERVER_IMAGE ?= bot-dot/server:latest
COMPUTER_IMAGE ?= bot-dot/desktop:latest
.PHONY: images
images: ## Build botdot's server image and the bots' computer image from this source, for a self-built botdot server (needs Docker)
	docker build -t "$(SERVER_IMAGE)" --label "org.opencontainers.image.revision=$$(git rev-parse HEAD 2>/dev/null || true)" .
	docker build -t "$(COMPUTER_IMAGE)" deploy/desktop

.PHONY: tools-real
tools-real: ## The real micromamba installs jq from conda-forge for one bot both ways, under the container's restrictions (needs Docker and the network)
	@./tests/integration/tools-real.sh

.PHONY: install-real
install-real: ## A first install with today's installer and images from a local registry, in a nested Docker daemon: botdot answers, a bot's computer starts and stops (needs Docker and the network)
	@./tests/integration/install-real.sh

.PHONY: accounts-real
accounts-real: ## Two accounts on one machine, in a nested Docker daemon: a sign-up link from the admin page makes the second, and neither account's bot, user or Docker reaches the other's containers, data or socket, nor its session the other; then the admin suspends, resumes and deletes the second, which leaves nothing of it on the machine, and a sign-in link gives it a new passkey; each account's share applies: its own disk, a computer beyond its share waits, a full disk is marked (needs Docker and the network)
	@./tests/integration/accounts-real.sh

.PHONY: gvisor-real
gvisor-real: ## ADR 028's spike: one account's real botdot and bot's computer in a rootless Docker under gVisor, its identity check, desktop, Camoufox and footprint (needs Docker and the network)
	@./tests/integration/gvisor-real.sh

.PHONY: image-cleanup-real
image-cleanup-real: ## Three updates of a machine of two accounts in a nested Docker daemon, by install.sh and by the admin page: the front door and both accounts run the new release, no Docker keeps an unused botdot image, a stopped computer and other workloads stay, an unsigned release is refused (needs Docker and the network)
	@./tests/integration/image-cleanup-real.sh
