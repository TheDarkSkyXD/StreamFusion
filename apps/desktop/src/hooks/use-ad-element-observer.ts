/**
 * Ad Element Observer Hook
 *
 * Uses MutationObserver to detect and hide dynamically-added ad elements.
 * Inspired by Ghostery's MutationObserver pattern.
 */

import { useEffect, useRef } from "react";

import { logger } from "@/renderer/logging/logger";

/**
 * Selectors for Twitch ad elements to hide
 * These are the DOM elements that show "Commercial Break in Progress"
 */
const AD_SELECTORS = [
  '[data-test-selector="ad-banner-default-text"]',
  '[data-test-selector="sad-overlay"]',
  ".player-ad-overlay",
  ".stream-display-ad",
];

/**
 * Hook that observes the DOM for ad elements and hides them
 * Inspired by Ghostery's MutationObserver pattern
 */
export function useAdElementObserver(enabled: boolean = true) {
  const observerRef = useRef<MutationObserver | null>(null);
  const hiddenCount = useRef(0);

  useEffect(() => {
    if (!enabled) {
      observerRef.current?.disconnect();
      return;
    }

    const hideElement = (element: Element) => {
      if (element instanceof HTMLElement) {
        element.style.display = "none";
        element.style.visibility = "hidden";
        element.style.opacity = "0";
        element.style.pointerEvents = "none";
        hiddenCount.current++;
        logger.debug("Player:Hook:AdElementObserver", "hidden element", {
          identifier: element.className || element.tagName,
        });
      }
    };

    const checkAndHide = (node: Node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as Element;

      // Check if this element matches any ad selector
      for (const selector of AD_SELECTORS) {
        if (element.matches(selector)) {
          hideElement(element);
          return;
        }
        // Also check descendants
        element.querySelectorAll(selector).forEach(hideElement);
      }
    };

    // Hide any existing ad elements
    AD_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach(hideElement);
    });

    // Watch for new elements
    observerRef.current = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          checkAndHide(node);
        }
      }
    });

    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true,
    });

    logger.debug("Player:Hook:AdElementObserver", "started watching for ad elements");

    return () => {
      observerRef.current?.disconnect();
      // Read hiddenCount.current at cleanup time for accurate count
      logger.debug("Player:Hook:AdElementObserver", "stopped", {
        hiddenCount: hiddenCount.current,
      });
    };
  }, [enabled]);

  return { hiddenCount: hiddenCount.current };
}
