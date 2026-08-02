import { describe, expect, it } from "vitest";

import { ENGLISH_ZIPFORMER_20M_MODEL } from "@/backend/services/captions/caption-model-catalog";

// Guards: the production allowlist cannot drift from the reviewed Zipformer revision, bytes, hashes, or license.
describe("local caption model catalog", () => {
  it("pins the complete English Zipformer 20M runtime manifest", () => {
    expect(ENGLISH_ZIPFORMER_20M_MODEL).toMatchObject({
      id: "zipformer-en-20m-2023-02-17",
      revision: "d42f2d9f7ca24806fb667456a18a9f1b60f70d16",
      languageLabel: "English",
      languageTag: "en",
      downloadBytes: 45_202_074,
      installedBytes: 45_202_074,
      license: "Apache-2.0",
      sourceName: "Hugging Face",
      sourceUrl:
        "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17",
    });
    expect(ENGLISH_ZIPFORMER_20M_MODEL.files).toEqual([
      {
        path: "encoder-epoch-99-avg-1.int8.onnx",
        size: 42_845_182,
        sha256: "3810755ce7c3ab26b42a8bcf39d191308fa27fb0f53358823ba46141d03b7eb3",
        url: expect.stringContaining(
          "/resolve/d42f2d9f7ca24806fb667456a18a9f1b60f70d16/encoder-epoch-99-avg-1.int8.onnx"
        ),
      },
      {
        path: "decoder-epoch-99-avg-1.onnx",
        size: 2_092_272,
        sha256: "45a7f940ecfb53d89fa270ad11b88b961e53a317203eb24b1c8e95ed208b0f30",
        url: expect.stringContaining(
          "/resolve/d42f2d9f7ca24806fb667456a18a9f1b60f70d16/decoder-epoch-99-avg-1.onnx"
        ),
      },
      {
        path: "joiner-epoch-99-avg-1.int8.onnx",
        size: 259_572,
        sha256: "e085d73b593cf9b0707f370dbd656d58327d3fe36d80d849202ef81df02cb01e",
        url: expect.stringContaining(
          "/resolve/d42f2d9f7ca24806fb667456a18a9f1b60f70d16/joiner-epoch-99-avg-1.int8.onnx"
        ),
      },
      {
        path: "tokens.txt",
        size: 5_048,
        sha256: "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb",
        url: expect.stringContaining(
          "/resolve/d42f2d9f7ca24806fb667456a18a9f1b60f70d16/tokens.txt"
        ),
      },
    ]);
    for (const file of ENGLISH_ZIPFORMER_20M_MODEL.files) {
      expect(file.url).not.toMatch(/[?&](?:token|auth)=/i);
    }
  });
});
