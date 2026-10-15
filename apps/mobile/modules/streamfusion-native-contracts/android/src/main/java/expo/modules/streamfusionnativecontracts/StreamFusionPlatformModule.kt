package expo.modules.streamfusionnativecontracts

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.util.Base64
import android.view.HapticFeedbackConstants
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsService
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.MessageDigest

class StreamFusionPlatformModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  private val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private var networkListeners = 0
  private var networkCallback: ConnectivityManager.NetworkCallback? = null

  override fun getName() = "StreamFusionPlatform"

  override fun getConstants(): MutableMap<String, Any> {
    val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
    return mutableMapOf(
      "appName" to context.applicationInfo.loadLabel(context.packageManager).toString(),
      "appVersion" to (packageInfo.versionName ?: "development"),
      "appScheme" to if (context.packageName.endsWith(".dev")) "streamfusion-development" else "streamfusion",
      "runtimeHost" to "bare",
    )
  }

  @ReactMethod
  fun sha256(value: String, promise: Promise) = NativeBridge.async(promise) {
    val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    Base64.encodeToString(digest, Base64.NO_WRAP)
  }

  @ReactMethod
  fun setClipboardText(value: String, promise: Promise) = NativeBridge.onMain(promise) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("StreamFusion", value))
    null
  }

  @ReactMethod
  fun getNetworkConnected(promise: Promise) = NativeBridge.async(promise) {
    val network = connectivity.activeNetwork ?: return@async false
    val capabilities = connectivity.getNetworkCapabilities(network) ?: return@async false
    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
      capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
  }

  @ReactMethod
  fun openAuthorizationTab(value: String, promise: Promise) = NativeBridge.onMain(promise) {
    val uri = Uri.parse(value)
    val permitted = uri.scheme == "https" && uri.userInfo == null && uri.port == -1 &&
      uri.fragment == null && (
        (uri.host == "www.twitch.tv" && uri.path == "/activate") ||
        (uri.host == "id.kick.com" && uri.path == "/oauth/authorize")
      )
    if (!permitted) throw IllegalArgumentException("The authorization page URL is invalid.")
    val activity = context.currentActivity ?: throw IllegalStateException("The in-app sign-in page is unavailable.")
    val serviceIntent = android.content.Intent(CustomTabsService.ACTION_CUSTOM_TABS_CONNECTION)
    val viewIntent = android.content.Intent(android.content.Intent.ACTION_VIEW, uri)
      .addCategory(android.content.Intent.CATEGORY_BROWSABLE)
    val viewPackages = activity.packageManager.queryIntentActivities(viewIntent, 0)
      .map { it.activityInfo.packageName }.toSet()
    val packages = activity.packageManager.queryIntentServices(serviceIntent, 0)
      .map { it.serviceInfo.packageName }.filter { it in viewPackages }
    val preferred = viewIntent
      .resolveActivity(activity.packageManager)?.packageName
    val browser = if (preferred != null && preferred in packages) preferred else packages.firstOrNull()
    if (browser == null) throw IllegalStateException("A browser with Custom Tabs support is required.")
    val tab = CustomTabsIntent.Builder()
      .setInitialActivityHeightPx(
        activity.resources.displayMetrics.heightPixels * 3 / 4,
        CustomTabsIntent.ACTIVITY_HEIGHT_ADJUSTABLE,
      )
      .setBackgroundInteractionEnabled(false)
      .setShowTitle(true)
      .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
      .build()
    tab.intent.setPackage(browser)
    tab.intent.data = uri
    // Partial Custom Tabs require a browser session or an activity-result launch.
    activity.startActivityForResult(tab.intent, AUTHORIZATION_REQUEST, tab.startAnimationBundle)
    null
  }

  @ReactMethod
  fun performHaptic(kind: String, promise: Promise) = NativeBridge.onMain(promise) {
    val view = context.currentActivity?.window?.decorView ?: return@onMain null
    val feedback = when (kind) {
      "selection" -> HapticFeedbackConstants.CLOCK_TICK
      "light" -> HapticFeedbackConstants.KEYBOARD_TAP
      "medium" -> HapticFeedbackConstants.VIRTUAL_KEY
      "warning" -> HapticFeedbackConstants.LONG_PRESS
      else -> throw IllegalArgumentException("Unknown haptic feedback type.")
    }
    view.performHapticFeedback(feedback)
    null
  }

  @ReactMethod
  fun lockOrientation(lock: String, promise: Promise) = NativeBridge.onMain(promise) {
    val activity = context.currentActivity ?: throw IllegalStateException("No active screen is available.")
    activity.requestedOrientation = when (lock) {
      "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      "portrait-up" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
      else -> throw IllegalArgumentException("Unknown orientation lock.")
    }
    null
  }

  @ReactMethod
  fun setNavigationBarHidden(hidden: Boolean, promise: Promise) = NativeBridge.onMain(promise) {
    val window = context.currentActivity?.window ?: return@onMain null
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    if (hidden) {
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      controller.hide(WindowInsetsCompat.Type.navigationBars())
    } else {
      controller.show(WindowInsetsCompat.Type.navigationBars())
    }
    null
  }

  @ReactMethod
  fun setSystemChromeColor(color: String, promise: Promise) = NativeBridge.onMain(promise) {
    val window = context.currentActivity?.window ?: return@onMain null
    window.decorView.setBackgroundColor(Color.parseColor(color))
    WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightNavigationBars = false
    null
  }

  @ReactMethod
  fun addListener(eventName: String) {
    if (eventName != "networkChanged") return
    networkListeners += 1
    if (networkCallback != null) return
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = emitNetworkChanged()
      override fun onLost(network: Network) = emitNetworkChanged()
      override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = emitNetworkChanged()
    }
    networkCallback = callback
    connectivity.registerDefaultNetworkCallback(callback)
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    networkListeners = (networkListeners - count).coerceAtLeast(0)
    if (networkListeners == 0) stopNetworkCallback()
  }

  private fun emitNetworkChanged() {
    NativeBridge.emit(context, "networkChanged", emptyMap())
  }

  private fun stopNetworkCallback() {
    networkCallback?.let { connectivity.unregisterNetworkCallback(it) }
    networkCallback = null
  }

  override fun invalidate() {
    stopNetworkCallback()
    super.invalidate()
  }

  companion object { private const val AUTHORIZATION_REQUEST = 4107 }
}
