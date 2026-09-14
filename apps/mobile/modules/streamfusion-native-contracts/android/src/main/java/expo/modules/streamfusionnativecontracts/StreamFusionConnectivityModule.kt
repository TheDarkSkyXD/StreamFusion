package expo.modules.streamfusionnativecontracts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.Credentials
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class StreamFusionConnectivityModule : Module() {
  private val calls = ConcurrentHashMap<String, okhttp3.Call>()

  override fun definition() = ModuleDefinition {
    Name("StreamFusionConnectivity")
    Function("getContractVersion") { 1 }
    AsyncFunction("cancelProxyRequest") { requestId: String ->
      calls.remove(requestId)?.cancel()
      mapOf("kind" to "completed")
    }
    AsyncFunction("proxyRequest") { request: Map<String, Any?> ->
      proxyRequest(request)
    }
  }

  private fun proxyRequest(request: Map<String, Any?>): Map<String, Any?> {
    val requestId = request["requestId"] as? String ?: return unsupported("A proxy request id is required.")
    val url = request["url"] as? String ?: return unsupported("A request URL is required.")
    val method = (request["method"] as? String)?.uppercase() ?: "GET"
    val host = request["host"] as? String ?: return unsupported("A proxy host is required.")
    val port = (request["port"] as? Number)?.toInt() ?: return unsupported("A proxy port is required.")
    if (port !in 1..65535) return unsupported("A proxy port is required.")
    val username = request["username"] as? String ?: ""
    val password = request["password"] as? String ?: ""
    val body = request["body"] as? String
    val headers = headersOf(request["headers"])
    val clientBuilder = OkHttpClient.Builder()
      .proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress(host, port)))
      .retryOnConnectionFailure(false)
      .callTimeout(30, TimeUnit.SECONDS)
      .connectTimeout(15, TimeUnit.SECONDS)
    if (username.isNotEmpty() || password.isNotEmpty()) {
      clientBuilder.proxyAuthenticator { _, response ->
        if (response.request.header("Proxy-Authorization") != null) {
          return@proxyAuthenticator null
        }
        response.request.newBuilder()
          .header("Proxy-Authorization", Credentials.basic(username, password))
          .build()
      }
    }
    val builder = Request.Builder().url(url).headers(headers)
    if (body != null && method != "GET" && method != "HEAD") {
      builder.method(method, body.toRequestBody(null))
    } else {
      builder.method(method, null)
    }
    val client = clientBuilder.build()
    val okRequest = builder.build()
    var lastError = "The proxied request failed."
    repeat(2) {
      val call = client.newCall(okRequest)
      calls[requestId] = call
      try {
        call.execute().use { response ->
          val responseHeaders = mutableMapOf<String, String>()
          for (index in 0 until response.headers.size) {
            responseHeaders[response.headers.name(index)] = response.headers.value(index)
          }
          return mapOf(
            "kind" to "completed",
            "status" to response.code,
            "headers" to responseHeaders,
            "body" to (response.body?.string() ?: ""),
          )
        }
      } catch (error: IOException) {
        if (call.isCanceled()) {
          return unsupported("The request was cancelled.")
        }
        lastError = error.message ?: "The proxied request failed."
      } finally {
        calls.remove(requestId)
      }
    }
    return unsupported(lastError)
  }

  private fun headersOf(value: Any?): Headers {
    val builder = Headers.Builder()
    val record = value as? Map<*, *> ?: return builder.build()
    for ((key, headerValue) in record) {
      if (key is String && headerValue is String) {
        builder.add(key, headerValue)
      }
    }
    return builder.build()
  }

  private fun unsupported(diagnostic: String): Map<String, Any?> = mapOf(
    "code" to "NATIVE_OPERATION_UNSUPPORTED",
    "diagnostic" to diagnostic,
    "kind" to "unsupported",
  )
}
