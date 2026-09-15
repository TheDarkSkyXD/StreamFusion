package expo.modules.streamfusionnativecontracts

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.nio.charset.StandardCharsets

internal class MediaJobHttpStream(
  val code: Int,
  val headers: Map<String, String>,
  val input: InputStream,
  private val closer: () -> Unit,
) : Closeable {
  override fun close() = closer()

  fun header(name: String): String? =
    headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
}

internal object MediaJobHttpClient {
  fun open(
    sourceUri: String,
    rangeStart: Long,
    extraHeaders: Map<String, String>,
  ): MediaJobHttpStream {
    val uri = URI(sourceUri)
    val port = if (uri.port > 0) uri.port else 80
    val socket = Socket()
    socket.soTimeout = 15_000
    socket.connect(InetSocketAddress(uri.host, port), 15_000)
    val path = buildPath(uri)
    val host = if (uri.port > 0) "${uri.host}:${uri.port}" else uri.host
    val request = StringBuilder()
      .append("GET ").append(path).append(" HTTP/1.1\r\n")
      .append("Host: ").append(host).append("\r\n")
      .append("Connection: close\r\n")
      .append("Accept-Encoding: identity\r\n")
    if (rangeStart > 0) {
      request.append("Range: bytes=").append(rangeStart).append("-\r\n")
    }
    extraHeaders.forEach { (key, value) ->
      if (!key.equals("Host", true) && !key.equals("Connection", true)) {
        request.append(key).append(": ").append(value).append("\r\n")
      }
    }
    request.append("\r\n")
    socket.getOutputStream().write(request.toString().toByteArray(StandardCharsets.US_ASCII))
    socket.getOutputStream().flush()
    val input = socket.getInputStream()
    val headerBlock = readHeaderBlock(input)
    android.util.Log.i("MediaJobHttp", "socket $sourceUri range=$rangeStart\n$headerBlock")
    val lines = headerBlock.split("\r\n")
    val status = lines.firstOrNull().orEmpty()
    val code = status.split(" ").getOrNull(1)?.toIntOrNull() ?: 0
    val headers = lines.drop(1).mapNotNull { line ->
      val index = line.indexOf(':')
      if (index <= 0) null else line.substring(0, index).trim() to line.substring(index + 1).trim()
    }.toMap()
    return MediaJobHttpStream(code, headers, input) {
      runCatching { socket.close() }
    }
  }

  private fun buildPath(uri: URI): String {
    val path = uri.rawPath.ifEmpty { "/" }
    val query = uri.rawQuery
    return if (query.isNullOrEmpty()) path else "$path?$query"
  }

  private fun readHeaderBlock(input: InputStream): String {
    val buffer = ByteArrayOutputStream()
    while (true) {
      val next = input.read()
      if (next < 0) break
      buffer.write(next)
      val bytes = buffer.toByteArray()
      if (
        bytes.size >= 4 &&
        bytes[bytes.size - 4] == '\r'.code.toByte() &&
        bytes[bytes.size - 3] == '\n'.code.toByte() &&
        bytes[bytes.size - 2] == '\r'.code.toByte() &&
        bytes[bytes.size - 1] == '\n'.code.toByte()
      ) {
        break
      }
    }
    return buffer.toString(StandardCharsets.ISO_8859_1.name())
  }
}
