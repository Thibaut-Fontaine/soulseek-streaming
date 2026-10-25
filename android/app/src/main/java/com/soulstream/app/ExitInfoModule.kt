package com.soulstream.app

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.io.InputStream

/**
 * Why the app's process ended last time, for the debug journal.
 *
 * A low-memory kill or a crash in native code (audio player, sockets) closes
 * the app without any JavaScript running, so the JS crash handler cannot see
 * it. Android 11+ keeps these reasons (ApplicationExitInfo); Java crashes are
 * also written to a file by MainApplication, with their stack trace.
 */
class ExitInfoModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName(): String = "SoulStreamExitInfo"

  @ReactMethod
  fun getRecentExits(max: Int, promise: Promise) {
    val result = Arguments.createArray()

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      promise.resolve(result)
      return
    }

    try {
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      for (info in manager.getHistoricalProcessExitReasons(context.packageName, 0, max)) {
        val entry = Arguments.createMap()
        entry.putDouble("timestamp", info.timestamp.toDouble())
        entry.putInt("reason", info.reason)
        entry.putInt("status", info.status)
        entry.putInt("importance", info.importance)
        // Kilobytes.
        entry.putDouble("pss", info.pss.toDouble())
        entry.putDouble("rss", info.rss.toDouble())
        entry.putString("description", info.description)
        // ANR traces are text; native crash traces are binary tombstones.
        if (info.reason == ApplicationExitInfo.REASON_ANR) {
          try {
            info.traceInputStream?.use { entry.putString("trace", readHead(it, TRACE_CHARS)) }
          } catch (_: Exception) {
            // The trace is optional.
          }
        }
        result.pushMap(entry)
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("exit_info", error)
    }
  }

  /** The last Java crash written by MainApplication, then deleted; null if none. */
  @ReactMethod
  fun takeJavaCrash(promise: Promise) {
    try {
      val file = File(context.filesDir, JAVA_CRASH_FILE)
      if (!file.exists()) {
        promise.resolve(null)
        return
      }
      val text = file.readText()
      file.delete()
      promise.resolve(text)
    } catch (error: Exception) {
      promise.resolve(null)
    }
  }

  private fun readHead(stream: InputStream, chars: Int): String {
    val bytes = ByteArray(chars)
    var total = 0
    while (total < chars) {
      val read = stream.read(bytes, total, chars - total)
      if (read <= 0) break
      total += read
    }
    return String(bytes, 0, total, Charsets.UTF_8)
  }

  companion object {
    const val JAVA_CRASH_FILE = "last-java-crash.txt"
    private const val TRACE_CHARS = 6000
  }
}

class ExitInfoPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
      listOf(ExitInfoModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
