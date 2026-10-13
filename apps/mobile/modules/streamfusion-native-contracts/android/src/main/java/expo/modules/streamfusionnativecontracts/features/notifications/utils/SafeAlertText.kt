package expo.modules.streamfusionnativecontracts

private val unsafeAlertText = Regex("https?://|bearer\\s", RegexOption.IGNORE_CASE)

internal fun safeAlertText(value: String, fallback: String): String {
  val clean = value.map { if (it.code < 32 || it.code == 127) ' ' else it }.joinToString("").trim().take(180)
  return if (clean.isEmpty() || unsafeAlertText.containsMatchIn(clean)) fallback else clean
}
