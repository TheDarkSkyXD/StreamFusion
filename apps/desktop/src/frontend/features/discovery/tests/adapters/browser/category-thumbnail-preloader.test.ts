import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preloadCategoryThumbnails } from "@/features/discovery/adapters/browser/category-thumbnail-preloader";

const images: HTMLImageElement[] = [];

beforeEach(() => {
  images.length = 0;
  vi.stubGlobal("Image", function () {
    const image = document.createElement("img");
    images.push(image);
    return image;
  });
});

afterEach(() => vi.unstubAllGlobals());

// Guards: category preloading retains only a bounded current batch, never a route-global image cache.
describe("category thumbnail preloading", () => {
  it("deduplicates the visible batch and cancels pending image sources on teardown", () => {
    const urls = Array.from({ length: 1_000 }, (_, index) => `https://images.test/${index}.jpg`);
    const cleanup = preloadCategoryThumbnails([urls[0], ...urls]);

    expect(images).toHaveLength(24);
    expect(images.map((image) => image.src)).toEqual(urls.slice(0, 24));

    cleanup();
    for (const image of images) {
      expect(image.getAttribute("src")).toBeNull();
      expect(image.onload).toBeNull();
      expect(image.onerror).toBeNull();
    }
  });

  it("releases completed and failed images before route cleanup", () => {
    const cleanup = preloadCategoryThumbnails([
      "https://images.test/loaded.jpg",
      "https://images.test/failed.jpg",
      "https://images.test/pending.jpg",
    ]);
    const [loaded, failed, pending] = images;
    const removeLoadedSource = vi.spyOn(loaded, "removeAttribute");
    const removeFailedSource = vi.spyOn(failed, "removeAttribute");

    loaded.dispatchEvent(new Event("load"));
    failed.dispatchEvent(new Event("error"));
    expect(loaded.onload).toBeNull();
    expect(loaded.onerror).toBeNull();
    expect(failed.onload).toBeNull();
    expect(failed.onerror).toBeNull();

    cleanup();
    expect(removeLoadedSource).not.toHaveBeenCalled();
    expect(removeFailedSource).not.toHaveBeenCalled();
    expect(pending.getAttribute("src")).toBeNull();
  });

  it("allows the next visit to preload a completed URL without retaining its old image", () => {
    const url = "https://images.test/return-visit.jpg";
    const firstCleanup = preloadCategoryThumbnails([url]);
    const firstImage = images[0];
    firstImage.dispatchEvent(new Event("load"));
    firstCleanup();

    const secondCleanup = preloadCategoryThumbnails([url]);
    expect(images).toHaveLength(2);
    expect(images[1]).not.toBe(firstImage);
    expect(images[1].src).toBe(url);
    secondCleanup();
    expect(images[1].getAttribute("src")).toBeNull();
  });
});
