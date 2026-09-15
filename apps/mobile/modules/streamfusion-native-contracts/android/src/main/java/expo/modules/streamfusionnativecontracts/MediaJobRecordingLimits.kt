package expo.modules.streamfusionnativecontracts

internal data class MediaJobRecordingLimits(
  val cutoffMs: Long,
  val warningMs: Long,
) {
  fun status(elapsedMs: Long): String {
    if (elapsedMs >= cutoffMs) return CUTOFF_STATUS
    if (elapsedMs >= warningMs) return WARNING_STATUS
    return "Running"
  }

  companion object {
    const val PRODUCT_CUTOFF_MS = 4L * 60L * 60L * 1000L
    const val PRODUCT_WARNING_LEAD_MS = 10L * 60L * 1000L
    const val COMPRESSED_CUTOFF_MS = 12_000L
    const val COMPRESSED_WARNING_MS = 8_000L
    const val WARNING_STATUS = "Recording will stop at the four-hour limit."
    const val CUTOFF_STATUS = "Stopped at the four-hour limit. Partial recording saved."
    const val STOPPED_STATUS = "Stopped. Partial recording saved."

    fun of(kind: String, sourceUri: String): MediaJobRecordingLimits? {
      if (kind != "recording") return null
      val explicit = Regex("[?&]cutoffMs=(\\d+)").find(sourceUri)?.groupValues?.get(1)?.toLongOrNull()
      if (explicit != null) {
        return MediaJobRecordingLimits(explicit, (explicit * 2) / 3)
      }
      if (sourceUri.contains("cutoff=compressed")) {
        return MediaJobRecordingLimits(COMPRESSED_CUTOFF_MS, COMPRESSED_WARNING_MS)
      }
      return MediaJobRecordingLimits(
        PRODUCT_CUTOFF_MS,
        PRODUCT_CUTOFF_MS - PRODUCT_WARNING_LEAD_MS,
      )
    }
  }
}
