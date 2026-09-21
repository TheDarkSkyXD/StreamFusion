import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  StyleSheet: {
    create: (styles: unknown) => styles,
    absoluteFillObject: {
      bottom: 0,
      left: 0,
      position: "absolute",
      right: 0,
      top: 0,
    },
  },
  Text: "Text",
  View: "View",
}));

import { fixtureStream } from "../domain/discovery-fixture";
import {
  featuredCarouselStreams,
  HOME_FEATURED_CAROUSEL_LIMIT,
  recommendedLiveStreams,
} from "../components/home-featured-carousel";

describe("home featured carousel helpers", () => {
  it("caps featured slides at Electron Home limit and mirrors Live Now slice(1)", () => {
    const streams = Array.from({ length: 12 }, (_, index) =>
      fixtureStream("twitch", `s${index}`, 100 - index),
    );
    const featured = featuredCarouselStreams(streams);
    expect(featured).toHaveLength(HOME_FEATURED_CAROUSEL_LIMIT);
    expect(featured[0]?.id).toBe("s0");
    expect(featured.at(-1)?.id).toBe("s9");
    const recommended = recommendedLiveStreams(streams);
    expect(recommended[0]?.id).toBe("s1");
    expect(recommended).toHaveLength(11);
  });
});
