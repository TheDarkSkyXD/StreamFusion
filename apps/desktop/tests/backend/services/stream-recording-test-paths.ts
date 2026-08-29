import { tmpdir } from "node:os";
import path from "node:path";

const testVideoDirectory = path.join(tmpdir(), "streamfusion-test-videos");

export function testVideoPath(fileName: string): string {
  return path.join(testVideoDirectory, fileName);
}
