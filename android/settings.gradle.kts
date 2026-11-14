pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "botdot"
include(":app")
include(":shared") // the data layer, shared with the iOS app (ADR 242): Kotlin Multiplatform
include(":baselineprofile") // makes the app's baseline profile (faster start and scrolling), see its README
