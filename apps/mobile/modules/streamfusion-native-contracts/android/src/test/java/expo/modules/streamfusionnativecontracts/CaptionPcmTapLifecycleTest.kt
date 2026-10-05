package expo.modules.streamfusionnativecontracts

import androidx.media3.common.C
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptionPcmTapLifecycleTest {
  @After
  fun clearSubscription() { CaptionPcmTap.subscription = null }

  @Test
  fun onlyTheMatchingSessionEndsAndStopsDeliveringAudio() {
    val delivered = mutableListOf<Triple<List<Byte>, Int, Int>>()
    var ended = 0
    val subscription = CaptionPcmTap.Subscription(
      "caption-player",
      { pcm, rate, channels -> delivered.add(Triple(pcm.toList(), rate, channels)) },
      { throw AssertionError(it) },
      { ended += 1 },
    )
    CaptionPcmTap.subscription = subscription
    val sink = CaptionPcmTap.forSession("caption-player")
    sink.flush(16_000, 1, C.ENCODING_PCM_16BIT)
    CaptionPcmTap.endSession("other-player")
    assertSame(subscription, CaptionPcmTap.subscription)
    sink.handleBuffer(ByteBuffer.wrap(byteArrayOf(1, 2)))
    CaptionPcmTap.endSession("caption-player")
    CaptionPcmTap.endSession("caption-player")
    sink.handleBuffer(ByteBuffer.wrap(byteArrayOf(3, 4)))
    assertEquals(listOf(Triple(listOf<Byte>(1, 2), 16_000, 1)), delivered)
    assertEquals(1, ended)
    assertEquals(null, CaptionPcmTap.subscription)
  }

  @Test
  fun concurrentEndCallsNotifyExactlyOnce() {
    val ended = AtomicInteger(0)
    CaptionPcmTap.subscription = CaptionPcmTap.Subscription("caption-player", { _, _, _ -> }, {}, { ended.incrementAndGet() })
    val ready = CountDownLatch(8)
    val start = CountDownLatch(1)
    val workers = List(8) {
      Thread {
        ready.countDown()
        start.await()
        CaptionPcmTap.endSession("caption-player")
      }.also { it.start() }
    }
    try {
      assertTrue(ready.await(3, TimeUnit.SECONDS))
    } finally {
      start.countDown()
      workers.forEach { it.join(3_000) }
    }
    assertTrue(workers.none { it.isAlive })
    assertEquals(1, ended.get())
    assertEquals(null, CaptionPcmTap.subscription)
  }

  @Test
  fun endingOneSubscriptionDoesNotClearItsCallbackReplacement() {
    var ended = 0
    val replacement = CaptionPcmTap.Subscription("replacement-player", { _, _, _ -> }, {}, {})
    CaptionPcmTap.subscription = CaptionPcmTap.Subscription("caption-player", { _, _, _ -> }, {}, {
      ended += 1
      CaptionPcmTap.subscription = replacement
    })
    CaptionPcmTap.endSession("caption-player")
    CaptionPcmTap.endSession("caption-player")
    assertEquals(1, ended)
    assertSame(replacement, CaptionPcmTap.subscription)
  }
}
