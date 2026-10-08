package expo.modules.streamfusionnativecontracts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class StreamFusionUpdaterModule : Module() {
  private var listener: ((Long) -> Unit)? = null

  override fun definition() = ModuleDefinition {
    Name("StreamFusionUpdater")
    Events("onUpdateRevision")
    OnCreate {
      val callback: (Long) -> Unit = { revision -> sendEvent("onUpdateRevision", mapOf("revision" to revision)) }
      listener = callback
      engine().listen(callback)
      appContext.currentActivity?.let { engine().onForeground(it) }
    }
    OnDestroy {
      listener?.let { engine().unlisten(it) }
      listener = null
    }
    OnActivityEntersForeground { engine().onForeground(appContext.currentActivity) }
    OnActivityEntersBackground { engine().onBackground() }
    AsyncFunction("snapshot") { engine().snapshot() }
    AsyncFunction("command") { command: Map<String, Any> ->
      engine().command(command, appContext.currentActivity)
    }
  }

  private fun engine(): UpdaterEngine {
    val context = requireNotNull(appContext.reactContext) { "Updater requires an Android application context." }
    return UpdaterEngine.get(context)
  }
}
