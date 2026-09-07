export interface LocalCaptionModelFile {
  path: string;
  size: number;
  sha256: string;
  url: string;
}

export interface LocalCaptionModelPack {
  id: string;
  revision: string;
  languageLabel: string;
  languageTag: string;
  downloadBytes: number;
  installedBytes: number;
  displaySize: string;
  license: string;
  sourceName: string;
  sourceUrl: string;
  files: readonly LocalCaptionModelFile[];
}

const REPOSITORY =
  "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17";
const REVISION = "d42f2d9f7ca24806fb667456a18a9f1b60f70d16";

function artifactUrl(path: string): string {
  return `${REPOSITORY}/resolve/${REVISION}/${path}`;
}

export const ENGLISH_ZIPFORMER_20M_MODEL: LocalCaptionModelPack = Object.freeze({
  id: "zipformer-en-20m-2023-02-17",
  revision: REVISION,
  languageLabel: "English",
  languageTag: "en",
  downloadBytes: 45_202_074,
  installedBytes: 45_202_074,
  displaySize: "43.11 MiB",
  license: "Apache-2.0",
  sourceName: "Hugging Face",
  sourceUrl: REPOSITORY,
  files: Object.freeze([
    Object.freeze({
      path: "encoder-epoch-99-avg-1.int8.onnx",
      size: 42_845_182,
      sha256: "3810755ce7c3ab26b42a8bcf39d191308fa27fb0f53358823ba46141d03b7eb3",
      url: artifactUrl("encoder-epoch-99-avg-1.int8.onnx"),
    }),
    Object.freeze({
      path: "decoder-epoch-99-avg-1.onnx",
      size: 2_092_272,
      sha256: "45a7f940ecfb53d89fa270ad11b88b961e53a317203eb24b1c8e95ed208b0f30",
      url: artifactUrl("decoder-epoch-99-avg-1.onnx"),
    }),
    Object.freeze({
      path: "joiner-epoch-99-avg-1.int8.onnx",
      size: 259_572,
      sha256: "e085d73b593cf9b0707f370dbd656d58327d3fe36d80d849202ef81df02cb01e",
      url: artifactUrl("joiner-epoch-99-avg-1.int8.onnx"),
    }),
    Object.freeze({
      path: "tokens.txt",
      size: 5_048,
      sha256: "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb",
      url: artifactUrl("tokens.txt"),
    }),
  ]),
});
