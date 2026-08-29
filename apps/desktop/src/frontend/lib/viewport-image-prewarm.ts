import { resolveProxiedImageSrc } from "./proxied-image-url";

export const VIEWPORT_PREWARM_LIMIT = 8;
export const VIEWPORT_PREWARM_CONCURRENCY = 4;
export const VIEWPORT_PREWARM_RETAIN_LIMIT = 64;
const PREWARM_TIMEOUT_MS = 3000;
const warmed = new Set<string>();
const retainedImages = new Map<string, HTMLImageElement>();
const pending: Array<{ src: string; resolve: () => void }> = [];
let activeCount = 0;

function retainImage(src: string, image: HTMLImageElement): void {
  retainedImages.set(src, image);
  if (retainedImages.size <= VIEWPORT_PREWARM_RETAIN_LIMIT) return;
  const oldestSrc = retainedImages.keys().next().value;
  if (oldestSrc) retainedImages.delete(oldestSrc);
}

function loadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (successful = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (successful) retainImage(src, image);
      resolve();
    };
    // timer-allowlist: image load/error races this deadline and clears the losing timer
    const timeout = setTimeout(finish, PREWARM_TIMEOUT_MS);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.decoding = "async";
    image.fetchPriority = "high";
    image.src = src;
  });
}

function pumpQueue(): void {
  while (activeCount < VIEWPORT_PREWARM_CONCURRENCY && pending.length > 0) {
    const task = pending.shift();
    if (!task) return;
    activeCount++;
    void loadImage(task.src).finally(() => {
      activeCount--;
      task.resolve();
      pumpQueue();
    });
  }
}

export async function prewarmViewportImages(urls: Array<string | null | undefined>): Promise<void> {
  const viewportUrls = [
    ...new Set(urls.map(resolveProxiedImageSrc).filter((url): url is string => Boolean(url))),
  ].slice(0, VIEWPORT_PREWARM_LIMIT);
  const queue = viewportUrls.filter((url) => !warmed.has(url));
  for (const url of queue) warmed.add(url);
  const tasks = queue.map(
    (src) =>
      new Promise<void>((resolve) => {
        pending.push({ src, resolve });
      })
  );
  pumpQueue();
  await Promise.all(tasks);
}

export function resetViewportImagePrewarmForTests(): void {
  warmed.clear();
  retainedImages.clear();
  pending.length = 0;
  activeCount = 0;
}

export function getRetainedViewportImageUrlsForTests(): string[] {
  return [...retainedImages.keys()];
}
