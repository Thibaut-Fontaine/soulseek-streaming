package com.soulstream.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import com.soulstream.app.auto.AutoBridge
import com.soulstream.app.auto.AutoSnapshot
import com.soulstream.app.auto.SoulStreamMediaService

/**
 * Bridge for Android Auto (feature 8): JavaScript pushes the browse tree and
 * playback state; the car's transport commands are emitted to JS, which owns
 * the actual player.
 */
class AutoModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

    private val listener = AutoBridge.Listener { command ->
        val event = Arguments.createMap().apply {
            putString("action", command.action.wire)
            command.mediaId?.let { putString("mediaId", it) }
            putDouble("positionMs", command.positionMs.toDouble())
        }
        context
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT, event)
    }

    override fun getName(): String = "SoulStreamAuto"

    override fun initialize() {
        super.initialize()
        AutoBridge.setListener(listener)
    }

    override fun invalidate() {
        AutoBridge.setListener(null)
        super.invalidate()
    }

    @ReactMethod
    fun update(treeJson: String, playbackJson: String, promise: Promise) {
        try {
            AutoSnapshot.save(context, treeJson, playbackJson)
            SoulStreamMediaService.refresh(context)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("auto_snapshot", error)
        }
    }

    // Required by NativeEventEmitter on the JavaScript side.
    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Int) = Unit

    companion object {
        const val EVENT = "SoulStreamAutoCommand"
    }
}

class AutoPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(AutoModule(context))

    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
