export const GRID_READY_PREDICATE = `(() => {
  for (const h of document.querySelectorAll('h1, h2, h3, [role="heading"]')) {
    if (/^(following|followed channels|channels you follow|following channels)$/i.test((h.textContent || '').trim())) {
      let p = h.parentElement;
      for (let i = 0; i < 6 && p; i++) {
        const includesRecommendations = Array.from(
          p.querySelectorAll('h1, h2, h3, [role="heading"]')
        ).some((candidate) => /^live channels$/i.test((candidate.textContent || '').trim()));
        if (!includesRecommendations && p.querySelectorAll('a[href] img').length >= 1) return true;
        if (
          !includesRecommendations &&
          /(?:aren't|are not|not following|no followed channels|don't follow any channels)/i.test(
            p.textContent || ''
          )
        ) return true;
        p = p.parentElement;
      }
    }
  }
  return false;
})()`;
