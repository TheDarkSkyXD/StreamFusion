package expo.modules.streamfusionnativecontracts

import androidx.media3.common.Player
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FocusedPipPolicyTest {
  @Test
  fun playingAndBufferingSessionsCanEnter() {
    assertTrue(FocusedPipPolicy.canEnter(true, true, Player.STATE_BUFFERING, false))
    assertTrue(FocusedPipPolicy.canEnter(true, true, Player.STATE_READY, false))
  }

  @Test
  fun pausedEndedFailedOrMissingSessionsCannotEnter() {
    assertFalse(FocusedPipPolicy.canEnter(true, false, Player.STATE_READY, false))
    assertFalse(FocusedPipPolicy.canEnter(true, true, Player.STATE_ENDED, false))
    assertFalse(FocusedPipPolicy.canEnter(true, true, Player.STATE_READY, true))
    assertFalse(FocusedPipPolicy.canEnter(false, true, Player.STATE_READY, false))
  }
}
