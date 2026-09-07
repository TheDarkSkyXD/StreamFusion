const MAX_CATEGORY_PRELOADS = 24;

export function preloadCategoryThumbnails(urls: readonly string[]): () => void {
  const pending = new Set<HTMLImageElement>();

  for (const url of [...new Set(urls)].slice(0, MAX_CATEGORY_PRELOADS)) {
    const image = new Image();
    const release = () => {
      pending.delete(image);
      image.onload = null;
      image.onerror = null;
    };
    pending.add(image);
    image.onload = release;
    image.onerror = release;
    image.decoding = "async";
    image.src = url;
  }

  return () => {
    for (const image of pending) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
    }
    pending.clear();
  };
}
