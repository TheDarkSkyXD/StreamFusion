import { describe, expect, it, vi } from "vitest";

import {
  LocalCaptionRecognizer,
  type SherpaOnlineRecognizer,
} from "@/backend/services/captions/local-caption-recognizer";

// Guards: sherpa partials retain session and cue identity, advance revisions, rotate after finalization, and map token timestamps onto the player media clock.
describe("LocalCaptionRecognizer", () => {
  it("groups ASCII-space word boundaries while preserving subword timing", () => {
    const stream = { acceptWaveform: vi.fn(), inputFinished: vi.fn() };
    const sherpa: SherpaOnlineRecognizer = {
      createStream: () => stream,
      isReady: vi.fn().mockReturnValue(false),
      decode: vi.fn(),
      isEndpoint: vi.fn().mockReturnValue(false),
      reset: vi.fn(),
      getResult: vi.fn().mockReturnValue({
        text: "ALL GOOD DAY",
        tokens: ["A", "LL", " GO", "OD", " DAY"],
        timestamps: [0.1, 0.2, 0.4, 0.6, 0.8],
        is_final: false,
      }),
    };
    const emit = vi.fn();
    const recognizer = new LocalCaptionRecognizer(sherpa, emit);
    recognizer.start({ sessionId: "twitch:talker", generation: 7 });

    recognizer.acceptAudio({
      sessionId: "twitch:talker",
      generation: 7,
      sequence: 1,
      mediaTime: 11,
      sampleRate: 16_000,
      samples: new Float32Array(16_000).buffer,
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "result",
        text: "ALL GOOD DAY",
        words: [
          { text: "ALL", startTime: 10.1, endTime: 10.4 },
          { text: "GOOD", startTime: 10.4, endTime: 10.8 },
          { text: "DAY", startTime: 10.8, endTime: 11 },
        ],
      })
    );
  });

  it("keeps one cue identity through finalization, then rotates for the next phrase", () => {
    const stream = { acceptWaveform: vi.fn(), inputFinished: vi.fn() };
    const sherpa: SherpaOnlineRecognizer = {
      createStream: () => stream,
      isReady: vi.fn().mockReturnValue(false),
      decode: vi.fn(),
      isEndpoint: vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true)
        .mockReturnValue(false),
      reset: vi.fn(),
      getResult: vi
        .fn()
        .mockReturnValueOnce({ text: "hello", tokens: ["\u2581hello"], timestamps: [0.1] })
        .mockReturnValueOnce({
          text: "hello world",
          tokens: ["\u2581hello", "\u2581world"],
          timestamps: [0.1, 0.4],
        })
        .mockReturnValueOnce({
          text: "hello world",
          tokens: ["\u2581hello", "\u2581world"],
          timestamps: [0.1, 0.4],
        })
        .mockReturnValueOnce({ text: "next", tokens: ["\u2581next"], timestamps: [0.1] }),
    };
    const emit = vi.fn();
    const recognizer = new LocalCaptionRecognizer(sherpa, emit);
    recognizer.start({ sessionId: "twitch:talker", generation: 7 });

    for (const sequence of [1, 2, 3, 4]) {
      recognizer.acceptAudio({
        sessionId: "twitch:talker",
        generation: 7,
        sequence,
        mediaTime: 10 + sequence,
        sampleRate: 16_000,
        samples: new Float32Array(16_000).buffer,
      });
    }

    const results = emit.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "result");
    expect(results).toMatchObject([
      { cueId: "twitch:talker:7:1", revision: 1, text: "hello" },
      { cueId: "twitch:talker:7:1", revision: 2, text: "hello world" },
      { cueId: "twitch:talker:7:1", revision: 3, text: "hello world", isFinal: true },
      { cueId: "twitch:talker:7:2", revision: 1, text: "next" },
    ]);
  });

  it("emits an incremental result with timestamped words and acknowledges the PCM chunk", () => {
    const stream = { acceptWaveform: vi.fn(), inputFinished: vi.fn() };
    const sherpa: SherpaOnlineRecognizer = {
      createStream: () => stream,
      isReady: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
      decode: vi.fn(),
      isEndpoint: vi.fn().mockReturnValue(false),
      reset: vi.fn(),
      getResult: vi.fn().mockReturnValue({
        text: "hello world",
        tokens: ["▁hello", "▁world"],
        timestamps: [0.1, 0.4],
        is_final: false,
      }),
    };
    const emit = vi.fn();
    const recognizer = new LocalCaptionRecognizer(sherpa, emit);
    recognizer.start({ sessionId: "twitch:talker", generation: 7 });

    recognizer.acceptAudio({
      sessionId: "twitch:talker",
      generation: 7,
      sequence: 3,
      mediaTime: 11,
      sampleRate: 16_000,
      samples: new Float32Array(16_000).buffer,
    });

    expect(stream.acceptWaveform).toHaveBeenCalledWith({
      sampleRate: 16_000,
      samples: expect.any(Float32Array),
    });
    expect(emit).toHaveBeenCalledWith({
      type: "result",
      sessionId: "twitch:talker",
      generation: 7,
      sequence: 3,
      mediaTime: 11,
      cueId: "twitch:talker:7:1",
      revision: 1,
      text: "hello world",
      isFinal: false,
      words: [
        { text: "hello", startTime: 10.1, endTime: 10.4 },
        { text: "world", startTime: 10.4, endTime: 11 },
      ],
    });
    expect(emit).toHaveBeenLastCalledWith({
      type: "ack",
      sessionId: "twitch:talker",
      generation: 7,
      sequence: 3,
    });
  });
});
