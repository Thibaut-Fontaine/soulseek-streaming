package com.soulstream.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * The installed build's versionCode/versionName from BuildConfig.
 *
 * The JS updater compares this code with the VPS manifest; reading it from
 * Gradle avoids keeping a second copy of the version in JavaScript.
 */
class BuildInfoModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName(): String = "SoulStreamBuildInfo"

  @ReactMethod
  fun getBuildInfo(promise: Promise) {
    try {
      val info = Arguments.createMap()
      info.putInt("versionCode", BuildConfig.VERSION_CODE)
      info.putString("versionName", BuildConfig.VERSION_NAME)
      promise.resolve(info)
    } catch (error: Exception) {
      promise.reject("build_info", error)
    }
  }
}

class BuildInfoPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
      listOf(BuildInfoModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
