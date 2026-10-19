import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.baselineprofile)
}

// Release signing: one fixed key, so a new build installs as an update over the old one.
// On GitHub it comes from the repo's secrets (BOTDOT_KEYSTORE_B64 etc., see .github/workflows/android.yml);
// on your computer from ~/.config/bot-dot/android-signing.properties (or BOTDOT_SIGNING=<file>).
val signing = Properties().apply {
    val file = System.getenv("BOTDOT_SIGNING")?.let(::file) ?: file("${System.getProperty("user.home")}/.config/bot-dot/android-signing.properties")
    if (file.exists()) file.inputStream().use { load(it) }
    System.getenv("BOTDOT_KEYSTORE")?.let { setProperty("storeFile", it) }
    System.getenv("BOTDOT_KEYSTORE_PASSWORD")?.let { setProperty("storePassword", it); setProperty("keyPassword", it) }
}
// Every GitHub build gets a higher version, so Android accepts it as an update.
val buildNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1

// The one figure every app draws bots from (docs/adr/003-one-figure-definition-for-all-apps.md): the app bundles the
// server's own file, read from the repository at build time, so there is no second copy in Git.
abstract class CopyFigure : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val source: RegularFileProperty

    @get:OutputDirectory
    abstract val out: DirectoryProperty

    @TaskAction
    fun copy() { source.get().asFile.copyTo(out.get().file("figure.json").asFile, overwrite = true) }
}
val figureDefinition = rootProject.file("../lib/figure.json")
val copyFigure = tasks.register<CopyFigure>("copyFigure") { source.set(figureDefinition) }
androidComponents { onVariants { it.sources.assets?.addGeneratedSourceDirectory(copyFigure, CopyFigure::out) } }

android {
    namespace = "dev.botdot.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.botdot.app"
        minSdk = 26
        targetSdk = 36
        versionCode = buildNumber
        versionName = "0.1.$buildNumber"
        // The tests that need Android itself (src/androidTest: the browser's way back to the app), on an emulator in CI.
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) create("release") {
            storeFile = file(signing.getProperty("storeFile"))
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias") ?: "botdot"
            keyPassword = signing.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        baseline = file("lint-baseline.xml") // what was there when lint came in; new problems fail the build
        abortOnError = true
        checkDependencies = false
    }

    testOptions {
        unitTests.isReturnDefaultValues = true // android.util.Log and the like do nothing in unit tests
        // Compose UI tests run on the JVM with Robolectric (KeypadUiTest), which reads the app's resources and manifest.
        unitTests.isIncludeAndroidResources = true
        // The Mention rules every app is checked against (MentionsTest).
        val mentionsTable = rootProject.file("../test/fixtures/mentions.json")
        val releaseVectors = rootProject.file("../test/fixtures/release-signing/vectors.json")
        unitTests.all { it.systemProperty("releaseVectors", releaseVectors.path); it.inputs.file(releaseVectors) }
        unitTests.all { it.systemProperty("mentionsTable", mentionsTable.path); it.inputs.file(mentionsTable) }
        // A job's schedule in words, as the server says it (ScheduleWordsTest).
        val cronWords = rootProject.file("../test/fixtures/cron-words.json")
        unitTests.all { it.systemProperty("cronWords", cronWords.path); it.inputs.file(cronWords) }
        // How a reply is read into blocks, as the web page reads it (MarkdownTest).
        val markdownCases = rootProject.file("../test/fixtures/markdown-cases.json")
        unitTests.all { it.systemProperty("markdownCases", markdownCases.path); it.inputs.file(markdownCases) }
        // The words of the Vault's item types, as the web page shows them (VaultTypesTest).
        val vaultTypes = rootProject.file("../test/fixtures/vault-types.json")
        unitTests.all { it.systemProperty("vaultTypes", vaultTypes.path); it.inputs.file(vaultTypes) }
        // The figure definition the app bundles (FigureTest).
        unitTests.all { it.systemProperty("figureDefinition", figureDefinition.path); it.inputs.file(figureDefinition) }
        // The definitions every renderer must take alike (FigureTest).
        val figureCases = rootProject.file("../test/fixtures/figure-cases.json")
        unitTests.all { it.systemProperty("figureCases", figureCases.path); it.inputs.file(figureCases) }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

composeCompiler {
    stabilityConfigurationFiles.add(project.layout.projectDirectory.file("compose-stability.conf"))
    // ./gradlew assembleRelease -PcomposeReports: which composables can be skipped, and which classes Compose sees as
    // unstable (in app/build/compose-reports).
    if (project.hasProperty("composeReports")) {
        reportsDestination = layout.buildDirectory.dir("compose-reports")
        metricsDestination = layout.buildDirectory.dir("compose-reports")
    }
}

dependencies {
    implementation(libs.androidx.core)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.okhttp)
    implementation(libs.okhttp.sse)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.reorderable) // dragging bots to pin them and change their order
    implementation(libs.coil.compose) // pictures: decoded at the size shown, kept in memory and on disk
    implementation(libs.coil.okhttp)
    // Signing in on the front door's page in a Custom Tab, where the browser's password manager answers the passkey.
    implementation(libs.androidx.browser)
    implementation(libs.androidx.profileinstaller) // installs the baseline profile: faster start and scrolling
    baselineProfile(project(":baselineprofile"))
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    // Compose UI tests on the JVM, with Robolectric (.github/workflows/tests.yml runs testDebugUnitTest).
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.robolectric)
    debugImplementation(libs.compose.ui.test.manifest) // the empty activity those tests draw in
    // On an emulator (.github/workflows/tests.yml, android-emulator): connectedDebugAndroidTest.
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.okhttp.mockwebserver)
}
