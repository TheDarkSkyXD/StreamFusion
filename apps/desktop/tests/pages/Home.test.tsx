import { beforeEach, describe, expect, it, vi } from "vitest";

import type { useTopStreams } from "@/hooks/queries/useStreams";

import { fixtures, renderWithProviders, routerMock, screen } from "../test-utils";

type TopStreamsState = Pick<ReturnType<typeof useTopStreams>, "data" | "isLoading" | "error">;

const topStreamsMock = vi.hoisted<{ state: TopStreamsState }>(() => ({
  state: { data: undefined, isLoading: false, error: null },
}));

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/hooks/queries/useStreams", () => ({
  useTopStreams: () => topStreamsMock.state,
  useStreamsByCategory: vi.fn(),
  useFollowedStreams: vi.fn(),
  useStreamByChannel: vi.fn(),
}));

vi.mock("@/pages/Home/components/featured-stage", () => ({
  FeaturedStage: ({
    stream,
    streams,
    isLoading,
  }: {
    stream?: { title: string };
    streams?: unknown[];
    isLoading?: boolean;
  }) => (
    <div data-testid="featured-stage">
      {isLoading ? "loading-featured" : (stream?.title ?? "no-featured")}
      <span data-testid="featured-stage-count">{streams?.length ?? 0}</span>
    </div>
  ),
}));

vi.mock("@/pages/Home/components/live-now-section", () => ({
  LiveNowSection: ({ streams }: { streams: unknown[] }) => (
    <div data-testid="live-now">streams: {streams.length}</div>
  ),
}));

import { HomePage } from "@/pages/Home";

// Guards: loading, error, and populated home states remain visibly distinct.
// Guards: the featured stream is removed exactly once from the live-now list.
describe("HomePage", () => {
  beforeEach(() => {
    topStreamsMock.state = { data: undefined, isLoading: false, error: null };
  });

  it("shows loading state passed to featured + live-now while fetching", () => {
    topStreamsMock.state = { data: undefined, isLoading: true, error: null };
    renderWithProviders(<HomePage />);
    expect(screen.getByTestId("featured-stage")).toHaveTextContent("loading-featured");
    expect(screen.getByTestId("live-now")).toHaveTextContent("streams: 0");
  });

  it("renders featured stream + remaining streams when data arrives", () => {
    const streams = [
      fixtures.stream({ id: "s1", title: "Featured!" }),
      fixtures.stream({ id: "s2", title: "Second" }),
      fixtures.stream({ id: "s3", title: "Third" }),
    ];
    topStreamsMock.state = { data: streams, isLoading: false, error: null };
    renderWithProviders(<HomePage />);
    expect(screen.getByTestId("featured-stage")).toHaveTextContent("Featured!");
    expect(screen.getByTestId("featured-stage-count")).toHaveTextContent("3");
    expect(screen.getByTestId("live-now")).toHaveTextContent("streams: 2");
  });

  it("shows error state with retry button on query failure", () => {
    topStreamsMock.state = {
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
    };
    renderWithProviders(<HomePage />);
    expect(screen.getByText(/failed to load streams/i)).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders the Browse All Categories link", () => {
    topStreamsMock.state = { data: [], isLoading: false, error: null };
    renderWithProviders(<HomePage />);
    expect(screen.getByText(/browse all categories/i)).toBeInTheDocument();
  });
});
