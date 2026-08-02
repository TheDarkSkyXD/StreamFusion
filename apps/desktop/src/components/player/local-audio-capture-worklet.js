const FRAME_BATCH_SIZE = 2048;

class StreamFusionDecodedAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME_BATCH_SIZE);
    this.length = 0;
    this.active = true;
    this.port.onmessage = (event) => {
      if (event.data?.type === "stop") this.active = false;
    };
  }

  process(inputs, outputs) {
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
    if (!this.active) return false;

    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const frameCount = Math.min(...channels.map((channel) => channel.length));

    for (let frame = 0; frame < frameCount; frame += 1) {
      let mono = 0;
      for (const channel of channels) mono += channel[frame];
      this.buffer[this.length] = mono / channels.length;
      this.length += 1;

      if (this.length === FRAME_BATCH_SIZE) {
        const pcm = this.buffer;
        this.port.postMessage({ pcm }, [pcm.buffer]);
        this.buffer = new Float32Array(FRAME_BATCH_SIZE);
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor("streamfusion-decoded-audio", StreamFusionDecodedAudioProcessor);
