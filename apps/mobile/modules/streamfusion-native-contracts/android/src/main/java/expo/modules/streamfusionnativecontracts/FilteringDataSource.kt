package expo.modules.streamfusionnativecontracts

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.nio.charset.StandardCharsets

class FilteringDataSource(
  private val upstream: DataSource,
  private val mode: String,
  private val onDiagnostic: (String, Boolean) -> Unit,
) : DataSource {
  private var delegate: DataSource = upstream
  private var openedUpstream = false

  override fun addTransferListener(transferListener: TransferListener) {
    upstream.addTransferListener(transferListener)
  }

  override fun open(dataSpec: DataSpec): Long {
    if (!shouldRewrite(dataSpec.uri) || mode == "passthrough") {
      return openUpstream(dataSpec)
    }
    return openFiltered(dataSpec)
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    return delegate.read(buffer, offset, length)
  }

  override fun getUri(): Uri? = delegate.uri

  override fun getResponseHeaders(): Map<String, List<String>> {
    return if (delegate === upstream) upstream.responseHeaders else emptyMap()
  }

  override fun close() {
    if (openedUpstream) {
      upstream.close()
      openedUpstream = false
    }
    if (delegate !== upstream) {
      delegate.close()
    }
  }

  private fun openUpstream(dataSpec: DataSpec): Long {
    delegate = upstream
    openedUpstream = true
    return delegate.open(dataSpec)
  }

  private fun openFiltered(dataSpec: DataSpec): Long {
    openedUpstream = true
    upstream.open(dataSpec)
    val original = readAll(upstream)
    upstream.close()
    openedUpstream = false
    val rewrittenBytes = rewriteOrKeep(original)
    delegate = ByteArrayDataSource(rewrittenBytes)
    return delegate.open(
      DataSpec.Builder()
        .setUri(dataSpec.uri)
        .setLength(rewrittenBytes.size.toLong())
        .build(),
    )
  }

  private fun rewriteOrKeep(original: ByteArray): ByteArray {
    val text = String(original, StandardCharsets.UTF_8)
    return try {
      val rewritten = PlaybackPlaylistFilter.rewrite(text, mode)
      onDiagnostic(rewritten.diagnostic, rewritten.adsDetected)
      rewritten.playlist.toByteArray(StandardCharsets.UTF_8)
    } catch (_: Throwable) {
      // Desktop fail-closed: known-unsafe media must not reach the player.
      if (mode == "strip" && PlaybackPlaylistFilter.hasAds(text)) {
        onDiagnostic("Filter failed; held unsafe media (fail-closed).", true)
        PlaybackPlaylistFilter.holdUnsafeMediaPlaylist(text)
          .toByteArray(StandardCharsets.UTF_8)
      } else {
        onDiagnostic("Filter failed. Original playlist kept.", false)
        original
      }
    }
  }

  private fun shouldRewrite(uri: Uri): Boolean {
    val path = uri.path?.lowercase().orEmpty()
    // Twitch media playlists always carry .m3u8 in the path; match contains() so
    // encoded or compound path segments still rewrite (desktop uses includes).
    return path.contains(".m3u8")
  }

  private fun readAll(source: DataSource): ByteArray {
    val chunks = ArrayList<ByteArray>()
    val buffer = ByteArray(16 * 1024)
    var total = 0
    while (true) {
      val read = source.read(buffer, 0, buffer.size)
      if (read == C.RESULT_END_OF_INPUT) break
      chunks.add(buffer.copyOf(read))
      total += read
    }
    val output = ByteArray(total)
    var offset = 0
    for (chunk in chunks) {
      System.arraycopy(chunk, 0, output, offset, chunk.size)
      offset += chunk.size
    }
    return output
  }

  class Factory(
    private val upstreamFactory: DataSource.Factory,
    private val mode: String,
    private val onDiagnostic: (String, Boolean) -> Unit,
  ) : DataSource.Factory {
    override fun createDataSource(): DataSource {
      return FilteringDataSource(upstreamFactory.createDataSource(), mode, onDiagnostic)
    }
  }
}
