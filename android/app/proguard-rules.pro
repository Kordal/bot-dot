# kotlinx.serialization: keep the generated serializers of the API's data classes.
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class dev.botdot.app.data.**$$serializer { *; }
-keepclassmembers class dev.botdot.app.data.** { *** Companion; }
-keepclasseswithmembers class dev.botdot.app.data.** { kotlinx.serialization.KSerializer serializer(...); }
# OkHttp ships its own rules; these silence optional platforms it probes for.
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
