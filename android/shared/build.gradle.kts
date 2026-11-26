import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework

// The app's data layer (docs/adr/242-…): the API, the store and every rule, in Kotlin Multiplatform, so the Android app
// and the iOS app run the same code. Its package stays dev.botdot.app.data, as it was in :app.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.kotlin.serialization)
    // Swift sees a Flow as an AsyncSequence and a suspend function as async (the iOS app, ios/, ADR 242).
    alias(libs.plugins.skie)
}

kotlin {
    android {
        namespace = "dev.botdot.shared"
        compileSdk = 37
        minSdk = 26
        compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
        withHostTest { isReturnDefaultValues = true } // android.util.Log and the like do nothing in unit tests
    }
    // BotdotShared.xcframework, for the iPhone and its simulator: ./gradlew :shared:assembleBotdotSharedDebugXCFramework
    // (or Release, for an archive: #1409), in build/XCFrameworks; ios/project.yml links the Debug one.
    val xcf = XCFramework("BotdotShared")
    listOf(iosArm64(), iosSimulatorArm64()).forEach {
        it.binaries.framework {
            baseName = "BotdotShared"
            isStatic = true
            xcf.add(this)
        }
    }

    compilerOptions { freeCompilerArgs.add("-Xexpect-actual-classes") }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.ktor.client.core)
            api(libs.kotlinx.serialization.json)
            api(libs.kotlinx.coroutines.core)
            api(libs.kotlinx.datetime)
            api(libs.kotlinx.io) // files handed to and from the API: kotlinx.io Path and RawSource
            api(libs.androidx.datastore.core)
            implementation(libs.kotlinx.atomicfu) // locks where the JVM code had @Synchronized
        }
        androidMain.dependencies {
            implementation(libs.ktor.client.okhttp)
            api(libs.okhttp) // Api.CLIENT: the one connection pool, which the pictures (Coil) share
            implementation(libs.androidx.core)
            implementation(libs.kotlinx.coroutines.android)
            implementation(libs.androidx.datastore)
            implementation(project.dependencies.platform(libs.compose.bom))
            implementation(libs.compose.runtime) // I18n's words are Compose state: a screen redraws when the language changes
        }
        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock) // a fake botdot for the shared tests (NeedsDeskTest)
        }
        getByName("androidHostTest").dependencies {
            implementation(libs.junit)
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.okhttp.mockwebserver)
        }
    }
}

// The rules every app is checked against, in the repository's test/fixtures (the web page's tests read the same files),
// and the figure definition the app bundles (FigureTest). commonTest reads them by key (TestFiles.kt fixture()): the
// build writes where each one is, on Android's host and in the iOS simulator alike.
val fixtures = mapOf(
    "mentionsTable" to "test/fixtures/mentions.json",
    "releaseVectors" to "test/fixtures/release-signing/vectors.json",
    "quoteCases" to "test/fixtures/quote-cases.json",
    "filePaths" to "test/fixtures/file-paths.json",
    "vaultTypes" to "test/fixtures/vault-types.json",
    "vaultSearch" to "test/fixtures/vault-search.json",
    "chatOrder" to "test/fixtures/chat-order.json",
    "answerQuestions" to "test/fixtures/answer-question-cases.json",
    "markdownCases" to "test/fixtures/markdown-cases.json",
    "chatLinks" to "test/fixtures/chat-links.json",
    "botNames" to "test/fixtures/bot-names.json",
    "pluralRules" to "test/fixtures/plural-rules.json",
    "polishPhrases" to "lib/i18n/pl/phrases.json",
    "figureCases" to "test/fixtures/figure-cases.json",
    "pushSeals" to "test/fixtures/push-seals.json",
    "figureDefinition" to "lib/figure.json",
    "uiCases" to "test/fixtures/ui-cases.json",
    "uiCatalog" to "lib/ui-catalog.json",
).mapValues { rootProject.file("../${it.value}") }

abstract class WriteFixtures : DefaultTask() {
    @get:Input abstract val paths: MapProperty<String, String>
    @get:OutputDirectory abstract val out: DirectoryProperty

    @TaskAction
    fun write() {
        val entries = paths.get().entries.joinToString(",\n") { (k, v) -> "    \"$k\" to \"${v.replace("\\", "\\\\").replace("\"", "\\\"")}\"" }
        out.get().file("dev/botdot/app/data/Fixtures.kt").asFile.apply { parentFile.mkdirs() }
            .writeText("package dev.botdot.app.data\n\n/** Where each shared fixture is (the build writes it). */\ninternal val FIXTURES = mapOf(\n$entries,\n)\n")
    }
}
val writeFixtures = tasks.register<WriteFixtures>("writeFixtures") {
    paths.set(fixtures.mapValues { it.value.absolutePath })
    out.set(layout.buildDirectory.dir("generated/fixtures/kotlin"))
}
kotlin.sourceSets.commonTest { kotlin.srcDir(writeFixtures) }
// Android lint reads the host tests' sources, the written fixture paths among them.
tasks.matching { it.name.contains("HostTest") && it.name.contains("lint", ignoreCase = true) }.configureEach { dependsOn(writeFixtures) }
tasks.withType<AbstractTestTask>().configureEach {
    inputs.files(fixtures.values).withPropertyName("fixtures")
    // A failed test says its message in the log, not only "AssertionError at Test.kt:21" (#1387): CI's log is all there is of a flake.
    testLogging { exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}

// The iOS tests run in the simulator IOS_SIMULATOR names (its UDID), as `make ios` does; else in Kotlin's own default.
providers.environmentVariable("IOS_SIMULATOR").orNull?.takeIf { it.isNotBlank() }?.let { id ->
    tasks.withType<org.jetbrains.kotlin.gradle.targets.native.tasks.KotlinNativeSimulatorTest>().configureEach { device.set(id) }
}

// SKIE sends nothing anywhere: no analytics from this build.
skie {
    analytics {
        disableUpload.set(true)
        enabled.set(false)
    }
}
