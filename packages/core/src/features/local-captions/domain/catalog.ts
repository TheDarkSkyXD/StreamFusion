export const LOCAL_CAPTION_MODEL_ID = "english-v1" as const;
export const LOCAL_CAPTION_DISPLAY_SIZE = "43.11 MiB";
export const LOCAL_CAPTION_DOWNLOAD_BYTES = 45_202_074;
export const LOCAL_CAPTION_LANGUAGE_LABEL = "English";
export const LOCAL_CAPTION_LANGUAGE_TAG = "en";
export const LOCAL_CAPTION_LICENSE = "Apache-2.0";
export const LOCAL_CAPTION_SOURCE_NAME = "Hugging Face";
export const LOCAL_CAPTION_SOURCE_URL =
  "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17";
export const LOCAL_CAPTION_REVISION =
  "d42f2d9f7ca24806fb667456a18a9f1b60f70d16";

export const LOCAL_CAPTION_FIXTURE_INSTALL_URI =
  "streamfusion-fixture://captions";
export const LOCAL_CAPTION_FIXTURE_PCM_URI =
  "streamfusion-fixture://captions?pcm";
export const LOCAL_CAPTION_FIXTURE_CONSTRAINED_URI =
  "streamfusion-fixture://captions?constrained";
export const LOCAL_CAPTION_FIXTURE_INTEGRITY_FAIL_URI =
  "streamfusion-fixture://captions?integrity-fail";

export const LOCAL_CAPTION_ONE_SESSION_STATUS =
  "One caption session is already running on the focused Stream.";
export const LOCAL_CAPTION_CONSTRAINED_STATUS =
  "Captions paused because this device is under resource pressure.";
export const LOCAL_CAPTION_NOT_INSTALLED_STATUS =
  "Install the 43.11 MiB English model to caption this Stream locally.";
export const LOCAL_CAPTION_READY_STATUS =
  "English model ready offline. 43.11 MiB. Audio stays on this device.";
export const LOCAL_CAPTION_NO_MICROPHONE_STATUS =
  "Local captions use decoded program audio. No microphone permission.";
export const LOCAL_CAPTION_NO_UPLOAD_STATUS =
  "Decoded program PCM stays on this device. No audio upload.";

export const LOCAL_CAPTION_PRODUCT_FILES = Object.freeze([
  Object.freeze({
    path: "encoder-epoch-99-avg-1.int8.onnx",
    size: 42_845_182,
    sha256: "3810755ce7c3ab26b42a8bcf39d191308fa27fb0f53358823ba46141d03b7eb3",
  }),
  Object.freeze({
    path: "decoder-epoch-99-avg-1.onnx",
    size: 2_092_272,
    sha256: "45a7f940ecfb53d89fa270ad11b88b961e53a317203eb24b1c8e95ed208b0f30",
  }),
  Object.freeze({
    path: "joiner-epoch-99-avg-1.int8.onnx",
    size: 259_572,
    sha256: "e085d73b593cf9b0707f370dbd656d58327d3fe36d80d849202ef81df02cb01e",
  }),
  Object.freeze({
    path: "tokens.txt",
    size: 5_048,
    sha256: "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb",
  }),
]);

export const LOCAL_CAPTION_FIXTURE_FILES = Object.freeze([
  Object.freeze({
    path: "encoder-epoch-99-avg-1.int8.onnx",
    contents: "streamfusion-caption-fixture-encoder-v1\n",
    sha256: "a9c0a2e86303d755bb500a883dac45f374c1551a372d6ba034bd5d187cd4c02b",
  }),
  Object.freeze({
    path: "decoder-epoch-99-avg-1.onnx",
    contents: "streamfusion-caption-fixture-decoder-v1\n",
    sha256: "95e4e1d530b9163899fe6ff13b816cb1730262b3c988e9e08d5c47e1f442dfaf",
  }),
  Object.freeze({
    path: "joiner-epoch-99-avg-1.int8.onnx",
    contents: "streamfusion-caption-fixture-joiner-v1\n",
    sha256: "024ca7b009541f629d7a775edb7abb00e926925f7aa39015a0504b705b353ae6",
  }),
  Object.freeze({
    path: "tokens.txt",
    contents: "streamfusion-caption-fixture-tokens-v1\n",
    sha256: "af6238b4b68b34e715c783e1f71c46e193517d96379ba0f0f430ba5c2919183f",
  }),
]);

export function isCaptionFixtureUri(sourceUri: string | undefined): boolean {
  return captionUri(sourceUri).startsWith(LOCAL_CAPTION_FIXTURE_INSTALL_URI);
}

export function isCaptionConstrainedUri(
  sourceUri: string | undefined,
): boolean {
  return captionUri(sourceUri).includes("constrained");
}

export function isCaptionIntegrityFailUri(
  sourceUri: string | undefined,
): boolean {
  return captionUri(sourceUri).includes("integrity-fail");
}

export function isCaptionFixturePcmUri(sourceUri: string | undefined): boolean {
  return captionUri(sourceUri).includes("pcm");
}

function captionUri(sourceUri: string | undefined): string {
  return sourceUri ?? "";
}
