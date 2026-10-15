package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ResolveInfo
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Looper
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsService
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.BridgeReactContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class AuthorizationSheetTest {
  @Test fun twitchOpensAboveTheAppInAResizableSheet() {
    assertAuthorizationSheet("https://www.twitch.tv/activate?public=true")
  }

  @Test fun kickOpensAboveTheAppInAResizableSheet() {
    assertAuthorizationSheet("https://id.kick.com/oauth/authorize?state=test-state")
  }

  private fun assertAuthorizationSheet(url: String) {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    val context = BridgeReactContext(RuntimeEnvironment.getApplication())
    context.onHostResume(activity)
    val packageManager = shadowOf(activity.packageManager)
    val browser = "test.customtabs.browser"
    packageManager.addResolveInfoForIntent(
      Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE),
      ResolveInfo().apply {
        activityInfo = ActivityInfo().apply { packageName = browser; name = "BrowserActivity" }
      },
    )
    packageManager.addResolveInfoForIntent(
      Intent(CustomTabsService.ACTION_CUSTOM_TABS_CONNECTION),
      ResolveInfo().apply {
        serviceInfo = ServiceInfo().apply { packageName = browser; name = "BrowserService" }
      },
    )
    val promise = PromiseImpl(Callback {}, Callback { error ->
      throw AssertionError("Authorization launch failed: ${error.contentToString()}")
    })

    StreamFusionPlatformModule(context).openAuthorizationTab(url, promise)
    shadowOf(Looper.getMainLooper()).idle()

    val resultLaunch = shadowOf(activity).nextStartedActivityForResult
    assertNotNull("The provider authorization page must open", resultLaunch)
    val launched = resultLaunch.intent
    assertEquals(url, launched.dataString)
    assertEquals(browser, launched.`package`)
    val height = launched.getIntExtra(CustomTabsIntent.EXTRA_INITIAL_ACTIVITY_HEIGHT_PX, 0)
    val screenHeight = activity.resources.displayMetrics.heightPixels
    assertEquals("The sheet leaves the app visible above it", screenHeight * 3 / 4, height)
    assertEquals(CustomTabsIntent.ACTIVITY_HEIGHT_ADJUSTABLE,
      launched.getIntExtra(CustomTabsIntent.EXTRA_ACTIVITY_HEIGHT_RESIZE_BEHAVIOR, -1))
    assertFalse("Sign-in stays in the app task", launched.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    assertEquals("Chrome requires a result launch to honor the sheet height", 4107, resultLaunch.requestCode)
  }
}
