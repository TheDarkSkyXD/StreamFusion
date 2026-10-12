package com.thedarkskyxd.streamfusion.dev

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import expo.modules.streamfusionnativecontracts.StreamFusionPackage

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(applicationContext, PackageList(this).packages.apply {
      add(StreamFusionPackage())
    }, useDevSupport = BuildConfig.DEBUG)
  }
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
