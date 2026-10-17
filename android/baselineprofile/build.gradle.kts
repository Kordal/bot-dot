plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.baselineprofile)
}

// Makes the app's baseline profile: the code a start and the usual first steps run, compiled ahead of time when the
// app is installed. Run with a phone or emulator connected (Android 13 or later), the app set up with a botdot:
//   ./gradlew :app:generateReleaseBaselineProfile
// It writes app/src/release/generated/baselineProfiles/baseline-prof.txt; commit that.
android {
    namespace = "dev.botdot.baselineprofile"
    compileSdk = 37

    defaultConfig {
        minSdk = 28
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    targetProjectPath = ":app"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

baselineProfile {
    useConnectedDevices = true
}

dependencies {
    implementation(libs.androidx.test.junit)
    implementation(libs.androidx.uiautomator)
    implementation(libs.androidx.benchmark.macro)
}
