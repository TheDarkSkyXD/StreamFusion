package com.thedarkskyxd.streamfusion.dev

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.streamfusionnativecontracts.StreamFusionPlaybackModule
import expo.modules.streamfusionnativecontracts.StreamFusionNotificationsModule

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(null)
    StreamFusionNotificationsModule.captureIntent(this, intent)
  }
  override fun getMainComponentName(): String = "main"
  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    StreamFusionPlaybackModule.onUserLeavesActivity(this)
  }
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    StreamFusionNotificationsModule.captureIntent(this, intent)
  }
}
