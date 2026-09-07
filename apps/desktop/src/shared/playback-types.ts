export interface StreamPlayback {
  url: string;
  format: "hls" | "dash" | "mp4";
  qualities?: {
    quality: string;
    url: string;
    frameRate?: number;
  }[];
}
