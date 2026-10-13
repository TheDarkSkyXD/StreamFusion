package expo.modules.streamfusionnativecontracts

import org.junit.Assert.*
import org.junit.Test

class LiveAlertJournalTest {
  private val channel = AlertChannel("kick", "saved-42", "example", "Example")
  private class MemoryStore : AlertJournalStore {
    var journal = AlertJournal()
    override fun read() = journal
    override fun write(journal: AlertJournal) { this.journal = journal }
  }
  private class Fixture {
    val store = MemoryStore()
    val posts = mutableListOf<String>()
    val owner = LiveAlertOwner(store, AlertPoster { event, _ -> posts.add(event.eventId); true })
  }
  private fun live(id: String, time: Long) = AlertObservation(channel.key, time, AlertRead.Live(id, "Stream title"))
  private fun offline(time: Long) = AlertObservation(channel.key, time, AlertRead.Offline)

  @Test fun firstLiveSeedsSilentlyAndChangedKickStreamCreatesOneEvent() {
    val f = Fixture()
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(live("100", 1)))
    assertTrue(f.owner.pending().isEmpty())
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(live("101", 2)))
    assertEquals(1, f.owner.pending().size)
    assertEquals("saved-42", f.owner.pending().single().channel.channelId)
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(live("101", 3)))
    assertEquals(1, f.owner.pending().size)
    assertEquals(1, f.posts.size)
  }
  @Test fun unavailableNeverEstablishesOfflineAndVerifiedOfflineAlerts() {
    val f = Fixture()
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(live("100", 1)))
    f.owner.accept(f.owner.lease(), listOf(AlertObservation(channel.key, 2, AlertRead.Unavailable)), 2)
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(live("100", 3)))
    assertTrue(f.owner.pending().isEmpty())
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(offline(4), live("101", 5)))
    assertEquals(1, f.owner.pending().size)
  }
  @Test fun historySurvivesDisabledPostingAndRestartGraceHandlesSuppressedSession() {
    val f = Fixture()
    val policy = AlertPolicy(systemAlerts = false, restartGraceMinutes = 5)
    f.owner.configure(listOf(channel), policy, listOf(offline(1), live("100", 2)))
    assertEquals(1, f.owner.pending().size)
    assertTrue(f.posts.isEmpty())
    f.owner.configure(listOf(channel), policy, listOf(live("101", 3), live("101", 400000)))
    assertEquals(1, f.owner.pending().size)
  }
  @Test fun foregroundAndMembershipChangesInvalidateInflightWorker() {
    val f = Fixture()
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(offline(1)))
    val old = f.owner.lease()
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(live("100", 3)))
    assertFalse(f.owner.accept(old, listOf(offline(2)), 4))
    val removed = f.owner.lease()
    f.owner.configure(emptyList(), AlertPolicy())
    assertFalse(f.owner.accept(removed, listOf(live("101", 5)), 5))
    assertEquals(1, f.owner.pending().size)
  }
  @Test fun durableReplayAndAcknowledgementNeverRepeatPostingAttempt() {
    val f = Fixture()
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(offline(1), live("100", 2)))
    val event = f.owner.pending().single()
    val restarted = LiveAlertOwner(f.store, AlertPoster { _, _ -> fail("Posting repeated after restart"); true })
    restarted.replay()
    assertEquals(event.eventId, restarted.pending().single().eventId)
    restarted.acknowledge(setOf("unknown", event.eventId))
    restarted.configure(listOf(channel), AlertPolicy(), listOf(live("100", 3)))
    assertTrue(restarted.pending().isEmpty())
  }
  @Test fun staleObservationAndOldHandledStreamCannotCreateAnotherEvent() {
    val f = Fixture()
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(live("100", 10), live("101", 20)))
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(offline(15), live("100", 30)))
    assertEquals(1, f.owner.pending().size)
  }
  @Test fun permissionFailureKeepsHistoryAndDoesNotRetryAfterPermissionReturns() {
    val store = MemoryStore()
    val denied = LiveAlertOwner(store, AlertPoster { _, _ -> false })
    denied.configure(listOf(channel), AlertPolicy(), listOf(offline(1), live("100", 2)))
    assertEquals("skipped", denied.pending().single().postState)
    val granted = LiveAlertOwner(store, AlertPoster { _, _ -> fail("A denied alert must not post later"); true })
    granted.replay()
    assertEquals("100", granted.pending().single().streamId)
  }
  @Test fun durableAttemptClaimPreventsPostingAfterCrash() {
    val store = MemoryStore()
    val owner = LiveAlertOwner(store, AlertPoster { _, _ -> throw AssertionError("Process died") })
    try {
      owner.configure(listOf(channel), AlertPolicy(), listOf(offline(1), live("100", 2)))
      fail("The simulated process death was not raised")
    } catch (_: AssertionError) { }
    assertEquals("attempted", store.journal.events.single().postState)
    val restart = LiveAlertOwner(store, AlertPoster { _, _ -> fail("An attempted post repeated"); true })
    restart.replay()
    assertEquals("100", restart.pending().single().streamId)
  }
  @Test fun storageFailureBeforeEventCommitNeverPosts() {
    var current = AlertJournal()
    var writable = true
    val store = object : AlertJournalStore {
      override fun read() = current
      override fun write(journal: AlertJournal) { check(writable); current = journal }
    }
    val posts = mutableListOf<String>()
    val owner = LiveAlertOwner(store, AlertPoster { event, _ -> posts.add(event.eventId); true })
    owner.configure(listOf(channel), AlertPolicy(), listOf(offline(1)))
    writable = false
    try { owner.configure(listOf(channel), AlertPolicy(), listOf(live("100", 2))); fail("Storage failure was ignored") }
    catch (_: IllegalStateException) { }
    assertTrue(posts.isEmpty())
    writable = true
    owner.configure(listOf(channel), AlertPolicy(), listOf(live("100", 3)))
    assertEquals(1, posts.size)
    assertEquals("100", owner.pending().single().streamId)
  }
  @Test fun fullInboxPreservesUnacknowledgedHistoryAndResumesAfterDrain() {
    val f = Fixture()
    f.owner.configure(listOf(channel), AlertPolicy(systemAlerts = false), listOf(offline(1)))
    for (index in 0 until 513) f.owner.configure(listOf(channel), AlertPolicy(systemAlerts = false), listOf(live("s$index", index + 2L)))
    assertEquals(512, f.owner.pending().size)
    assertEquals("s0", f.owner.pending().first().streamId)
    assertEquals("inbox-full", f.owner.status().failure)
    f.owner.acknowledge(f.owner.pending().map { it.eventId }.toSet())
    f.owner.configure(listOf(channel), AlertPolicy(systemAlerts = false), listOf(live("s512", 600)))
    assertEquals("s512", f.owner.pending().single().streamId)
  }
  @Test fun workerCursorRotatesWithoutDroppingMembership() {
    val f = Fixture()
    val channels = (0 until 4).map { channel.copy(channelId = "saved-$it") }
    f.owner.configure(channels, AlertPolicy())
    val lease = f.owner.lease()
    f.owner.accept(lease, lease.channels.take(2).map { AlertObservation(it.key, 1, AlertRead.Unavailable) }, 1)
    assertEquals(listOf("saved-2", "saved-3", "saved-0", "saved-1"), f.owner.lease().channels.map { it.channelId })
    assertEquals(4, f.owner.status().channels.size)
  }
  @Test fun failedPollStatusSurvivesConfigurationRefreshUntilVerifiedRead() {
    val f = Fixture()
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(offline(1)))
    f.owner.accept(f.owner.lease(), listOf(AlertObservation(channel.key, 2, AlertRead.Unavailable)), 2)
    assertEquals("provider-unavailable", f.owner.status().failure)
    f.owner.configure(listOf(channel), AlertPolicy())
    assertEquals("provider-unavailable", f.owner.status().failure)
    f.owner.accept(f.owner.lease(), listOf(live("100", 3)), 3)
    assertEquals(1, f.owner.pending().size)
    assertNull(f.owner.status().failure)
  }
  @Test fun acknowledgingHistoryDuringHttpDoesNotDiscardNewLiveObservation() {
    val f = Fixture()
    f.owner.configure(listOf(channel), AlertPolicy(), listOf(offline(1), live("100", 2)))
    val event = f.owner.pending().single()
    val lease = f.owner.lease()
    f.owner.acknowledge(setOf(event.eventId))
    assertTrue(f.owner.accept(lease, listOf(live("101", 3)), 3))
    assertEquals("101", f.owner.pending().single().streamId)
    assertEquals(2, f.posts.size)
  }
  @Test fun backlogReplayPostsAllEventsWithinTwoEncryptedJournalWrites() {
    var journal = AlertJournal(channels = listOf(channel), policy = AlertPolicy(), events = (100..102).map {
      AlertEvent("local:live-alert:test:$it", channel, "$it", "Live title", it.toLong())
    })
    var writes = 0
    val store = object : AlertJournalStore {
      override fun read() = journal
      override fun write(value: AlertJournal) {
        check(++writes <= 2) { "Replay exceeded its encrypted write budget." }
        journal = value
      }
    }
    val posts = mutableListOf<String>()
    val owner = LiveAlertOwner(store, AlertPoster { event, _ -> posts.add(event.streamId); true })
    owner.replay()
    assertEquals(listOf("100", "101", "102"), posts)
    assertEquals(listOf("posted", "posted", "posted"), owner.pending().map { it.postState })
    assertEquals(3, owner.pending().size)
  }
}
