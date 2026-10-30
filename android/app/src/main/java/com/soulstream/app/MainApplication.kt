package com.soulstream.app

import android.app.Application
import android.util.Log
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import java.io.File

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              add(ExitInfoPackage())
              add(BuildInfoPackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    recordJavaCrashes()
    loadReactNative(this)
  }

  /**
   * Writes the stack trace of an uncaught Java/Kotlin exception (e.g. in the
   * audio player service) before the process dies, so the next launch can
   * show it in the debug journal. The default handler still runs after.
   */
  private fun recordJavaCrashes() {
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        val text = "${System.currentTimeMillis()}\n${thread.name}\n${Log.getStackTraceString(error)}"
        File(filesDir, ExitInfoModule.JAVA_CRASH_FILE).writeText(text.take(20000))
      } catch (_: Throwable) {
        // Never get in the way of the crash itself.
      }
      previous?.uncaughtException(thread, error)
    }
  }
}
