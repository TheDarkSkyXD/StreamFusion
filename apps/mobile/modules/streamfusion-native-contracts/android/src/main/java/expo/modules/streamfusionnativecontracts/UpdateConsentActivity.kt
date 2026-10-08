package expo.modules.streamfusionnativecontracts

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle

class UpdateConsentActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val approval = if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableExtra("approval", Intent::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra("approval") as? Intent
    }
    if (approval != null) startActivity(approval)
    finish()
  }
}
