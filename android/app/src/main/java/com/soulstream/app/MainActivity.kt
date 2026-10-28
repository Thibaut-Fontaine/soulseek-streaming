package com.soulstream.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "SoulStream"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    intent?.let { intent = sharedTextAsLink(it) }
    super.onCreate(savedInstanceState)
  }

  override fun onNewIntent(intent: Intent) {
    val link = sharedTextAsLink(intent)
    setIntent(link)
    super.onNewIntent(link)
  }

  /**
   * React Native's Linking only sees VIEW intents with a URI. A message shared
   * to the app (ACTION_SEND) becomes soulstream://shared?text=…, and the
   * JavaScript side finds the track link inside it (src/core/share.ts).
   */
  private fun sharedTextAsLink(intent: Intent): Intent {
    if (intent.action != Intent.ACTION_SEND) {
      return intent
    }
    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return intent
    return Intent(Intent.ACTION_VIEW, Uri.parse("soulstream://shared?text=" + Uri.encode(text)))
  }
}
