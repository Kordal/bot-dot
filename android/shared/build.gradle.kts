import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// The app's data layer (docs/adr/242-…): the API, the store and every rule, in Kotlin Multiplatform, so the Android app
// and the iOS app run the same code. Its package stays dev.botdot.app.data, as it was in :app.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    android {
        namespace = "dev.botdot.shared"
        compileSdk = 37
        minSdk = 26
        compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
        withHostTest { isReturnDefaultValues = true } // android.util.Log and the like do nothing in unit tests
    }
    iosArm64()
    iosSimulatorArm64()

    compilerOptions { freeCompilerArgs.add("-Xexpect-actual-classes") }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.ktor.client.core)
            api(libs.kotlinx.serialization.json)
            api(libs.kotlinx.coroutines.core)
            api(libs.kotlinx.datetime)
            api(libs.androidx.datastore.core)
        }
        androidMain.dependencies {
            implementation(libs.ktor.client.okhttp)
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
        }
        getByName("androidHostTest").dependencies {
            implementation(libs.junit)
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.okhttp.mockwebserver)
        }
    }
}
