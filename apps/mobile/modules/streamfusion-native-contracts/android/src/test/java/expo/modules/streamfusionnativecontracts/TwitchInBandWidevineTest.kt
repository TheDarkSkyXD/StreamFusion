package expo.modules.streamfusionnativecontracts

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.TimestampAdjuster
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser
import androidx.media3.extractor.DefaultExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.mp4.PsshAtomUtil
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class TwitchInBandWidevineTest {
  @Test fun keylessHlsExtractsInBandPsshAndRotatedEncryptedSampleKeys() {
    val text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:2,\nsegment.m4s\n"
    val playlist = HlsPlaylistParser().parse(Uri.parse("https://media.example/live.m3u8"), ByteArrayInputStream(text.toByteArray())) as HlsMediaPlaylist
    assertNull(playlist.segments.single().drmInitData)
    val firstKey = ByteArray(16) { 1 }
    val nextKey = ByteArray(16) { 2 }
    val firstPssh = PsshAtomUtil.buildPsshAtom(C.WIDEVINE_UUID, byteArrayOf(8, 1))
    val nextPssh = PsshAtomUtil.buildPsshAtom(C.WIDEVINE_UUID, byteArrayOf(8, 2))
    val output = CapturedOutput()
    val input = input(init(firstKey, firstPssh) + fragment(null))
    val extractor = DefaultHlsExtractorFactory().createExtractor(Uri.parse("https://media.example/init.mp4"),
      Format.Builder().setCodecs("mp4a.40.2").build(), emptyList(), TimestampAdjuster(0), emptyMap(), input, PlayerId.UNSET)
    extractor.init(output)
    while (extractor.read(input)) { }
    assertEquals("audio/mp4a-latm", output.formats.last().sampleMimeType)
    assertArrayEquals(firstPssh, output.formats.last().drmInitData!![0].data)
    assertArrayEquals(firstKey, output.keys.single())
    assertTrue(output.flags.single() and C.BUFFER_FLAG_ENCRYPTED != 0)
    val rotated = input(init(nextKey, nextPssh) + fragment(nextPssh))
    while (extractor.read(rotated)) { }
    assertArrayEquals(nextPssh, output.formats.last().drmInitData!![0].data)
    assertEquals("cenc", output.formats.last().drmInitData!!.schemeType)
    assertArrayEquals(nextKey, output.keys.last())
    assertEquals(2, output.keys.size)
  }

  private fun input(bytes: ByteArray) = DefaultExtractorInput(object : DataReader {
    val stream = ByteArrayInputStream(bytes)
    override fun read(buffer: ByteArray, offset: Int, length: Int) = stream.read(buffer, offset, length)
  }, 0, bytes.size.toLong())

  private fun ints(vararg values: Int): ByteArray = ByteBuffer.allocate(values.size * 4).also { buffer -> values.forEach(buffer::putInt) }.array()
  private fun box(type: String, vararg parts: ByteArray): ByteArray {
    val payload = parts.fold(ByteArray(0)) { bytes, part -> bytes + part }
    return ints(payload.size + 8) + type.toByteArray(Charsets.US_ASCII) + payload
  }

  private fun init(key: ByteArray, pssh: ByteArray): ByteArray {
    val encryption = box("sinf", box("frma", "mp4a".toByteArray()), box("schm", ints(0), "cenc".toByteArray(), ints(65536)),
      box("schi", box("tenc", ints(0), byteArrayOf(0, 0, 1, 8), key)))
    val esds = box("esds", ints(0), byteArrayOf(3, 25, 0, 1, 0, 4, 17, 64, 21, 0, 0, 0, 0, 1, -12, 0, 0, 1, -12, 0, 5, 2, 18, 16, 6, 1, 2))
    val audioHeader = ByteBuffer.allocate(28).put(ByteArray(6)).putShort(1).putLong(0).putShort(2).putShort(16)
      .putInt(0).putInt(44100 shl 16).array()
    val stbl = box("stbl", box("stsd", ints(0, 1), box("enca", audioHeader, encryption, esds)), box("stsz", ints(0, 0, 0)))
    val mdia = box("mdia", box("mdhd", ints(0, 0, 0, 44100, 0, 0)), box("hdlr", ints(0, 0), "soun".toByteArray(), ByteArray(12)), box("minf", stbl))
    val tkhd = box("tkhd", ints(0, 0, 0, 1, 0, 0), ByteArray(16), ints(65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824), ByteArray(8))
    return box("ftyp", "iso6".toByteArray(), ints(0), "iso6mp41".toByteArray()) + box("moov",
      box("mvhd", ints(0, 0, 0, 1000, 0), ByteArray(80)), pssh,
      box("mvex", box("trex", ints(0, 1, 1, 1024, 4, 0))), box("trak", tkhd, mdia))
  }

  private fun fragment(pssh: ByteArray?): ByteArray {
    val traf = box("traf", box("tfhd", ints(0x020000, 1)), box("tfdt", ints(0, 0)), box("trun", ints(1, 1, 0)),
      box("senc", ints(0, 1), ByteArray(8)))
    val provisional = box("moof", box("mfhd", ints(0, 1)), traf, pssh ?: ByteArray(0))
    val fixedTraf = box("traf", box("tfhd", ints(0x020000, 1)), box("tfdt", ints(0, 0)), box("trun", ints(1, 1, provisional.size + 8)),
      box("senc", ints(0, 1), ByteArray(8)))
    return box("moof", box("mfhd", ints(0, 1)), fixedTraf, pssh ?: ByteArray(0)) + box("mdat", byteArrayOf(1, 2, 3, 4))
  }

  private class CapturedOutput : ExtractorOutput, TrackOutput {
    val formats = mutableListOf<Format>()
    val keys = mutableListOf<ByteArray>()
    val flags = mutableListOf<Int>()
    override fun track(id: Int, type: Int): TrackOutput = this
    override fun endTracks() = Unit
    override fun seekMap(seekMap: SeekMap) = Unit
    override fun format(format: Format) { formats.add(format) }
    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int = input.read(ByteArray(length), 0, length)
    override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) { data.skipBytes(length) }
    override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
      this.flags.add(flags)
      cryptoData?.let { keys.add(it.encryptionKey) }
    }
  }
}
