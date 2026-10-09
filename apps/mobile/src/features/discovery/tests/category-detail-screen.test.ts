import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { D07_PROOF_TOKEN } from "../components/category-discovery-proof-controls";
import { CategoryDetailView } from "../components/category-detail-screen";
import { composeCategoryDetail } from "../domain/category-detail";
import {
  defaultCategoryRequest,
  type CategoryRequestIdentity,
} from "../domain/category-identity";
import {
  fixtureClip,
  fixtureOutcome,
  fixtureStream,
  fixtureVideo,
} from "../domain/discovery-fixture";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

vi.mock("lucide-react-native", () => ({
  ChevronDown: "ChevronDown",
  ChevronUp: "ChevronUp",
  SlidersHorizontal: "SlidersHorizontal",
}));

vi.mock("@mobile/design/select", () => ({ MobileSelect: "MobileSelect" }));
vi.mock("@mobile/design/bottom-sheet", () => ({
  MobileBottomSheet: ({
    children,
    footer,
    visible,
  }: {
    children: unknown;
    footer: unknown;
    visible: boolean;
  }) => (visible ? [children, footer] : null),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => [
    typeof initial === "boolean" ? true : initial,
    () => undefined,
  ],
}));

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  children?: unknown;
  disabled?: boolean;
  onOpen?: () => void;
  onPress?: () => void;
  onChange?: (value: string) => void;
  options?: readonly { readonly label: string; readonly value: string }[];
  testID?: string;
}>;
type Element = ReactElement<ElementProps>;

function descendants(node: unknown): readonly Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child));
  if (!isValidElement<ElementProps>(node)) return [];
  const element: Element = node;
  const candidate = element.type as unknown;
  const component =
    typeof candidate === "function"
      ? (candidate as (props: ElementProps) => unknown)
      : typeof candidate === "object" &&
          candidate !== null &&
          "type" in candidate &&
          typeof candidate.type === "function"
        ? (candidate.type as (props: ElementProps) => unknown)
        : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

const chatting = {
  boxArtUrl: "https://example.com/box.png",
  id: "509658",
  name: "Just Chatting",
  otherId: "15",
  platform: "twitch" as const,
};

describe("Category detail screen", () => {
  it("uses underline tabs and opens live and recorded items", () => {
    const onWatch = vi.fn();
    const live = CategoryDetailView({
      onChangeIdentity: () => undefined,
      onChangeQuery: () => undefined,
      onOpenAccounts: () => undefined,
      onWatch,
      query: "",
      view: composeCategoryDetail({
        identity: defaultCategoryRequest(chatting, "all", "all"),
        loading: false,
        twitch: {
          ...fixtureOutcome("twitch", "ready"),
          items: [fixtureStream("twitch", "live", 10)],
        },
      }),
    });
    const liveNodes = descendants(live);
    expect(
      liveNodes.some((node) => node.props.testID === "category-tabs"),
    ).toBe(true);
    liveNodes
      .find((node) => node.props.testID === "home-stream-twitch-live")
      ?.props.onPress?.();
    expect(onWatch).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "twitch" }),
    );

    for (const tab of ["clips", "videos"] as const) {
      const item =
        tab === "clips"
          ? fixtureClip("twitch", "clip", 10)
          : fixtureVideo("twitch", "video", 10);
      const recorded = CategoryDetailView({
        onChangeIdentity: () => undefined,
        onChangeQuery: () => undefined,
        onOpenAccounts: () => undefined,
        onWatch,
        query: "",
        view: composeCategoryDetail({
          identity: { ...defaultCategoryRequest(chatting, "all", "all"), tab },
          loading: false,
          twitch: { ...fixtureOutcome("twitch", "ready"), items: [item] },
        }),
      });
      descendants(recorded)
        .find(
          (node) => node.props.testID === `category-recorded-twitch-${item.id}`,
        )
        ?.props.onPress?.();
      expect(onWatch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          media: expect.objectContaining({
            kind: tab === "clips" ? "clip" : "video",
          }),
        }),
      );
    }
  });

  it("renders Follow as explained-unavailable and stamps the D07 token", () => {
    const root = CategoryDetailView({
      onChangeIdentity: () => undefined,
      onChangeQuery: () => undefined,
      onOpenAccounts: () => undefined,
      onSelectProofMode: () => undefined,
      proofMode: "ready",
      query: "",
      view: composeCategoryDetail({
        identity: defaultCategoryRequest(chatting, "all", "all"),
        loading: false,
        twitch: fixtureOutcome("twitch", "ready"),
      }),
    });
    const nodes = descendants(root);
    expect(nodes.some((node) => node.props.testID === "category-follow")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.props.testID === "category-follow-reason"),
    ).toBe(true);
    expect(nodes.some((node) => node.props.children === D07_PROOF_TOKEN)).toBe(
      true,
    );
  });

  it("explains Kick clips as unsupported", () => {
    const root = CategoryDetailView({
      onChangeIdentity: () => undefined,
      onChangeQuery: () => undefined,
      onOpenAccounts: () => undefined,
      query: "",
      view: composeCategoryDetail({
        identity: {
          ...defaultCategoryRequest(chatting, "all", "all"),
          platformScope: "kick",
          tab: "clips",
        },
        kickUnavailable: {
          kind: "unavailable",
          reason: "kick-clips-unsupported",
        },
        loading: false,
      }),
    });
    const nodes = descendants(root);
    expect(
      nodes.some((node) => node.props.testID === "category-unsupported"),
    ).toBe(true);
  });

  it("offers clip sort choices without an inactive language filter", () => {
    const onChangeIdentity = vi.fn();
    const identity: CategoryRequestIdentity = {
      ...defaultCategoryRequest(chatting, "all", "all"),
      tab: "clips",
    };
    const root = CategoryDetailView({
      onChangeIdentity,
      onChangeQuery: () => undefined,
      onOpenAccounts: () => undefined,
      query: "",
      view: composeCategoryDetail({
        identity,
        loading: false,
        twitch: fixtureOutcome("twitch", "ready"),
      }),
    });
    const nodes = descendants(root);
    const sort = nodes.find((node) => node.props.testID === "category-sort");
    expect(sort?.props.options).toEqual([
      { label: "Views", value: "views" },
      { label: "Most Recent", value: "recent" },
    ]);

    expect(
      nodes.some((node) => node.props.testID === "category-language"),
    ).toBe(false);
    expect(onChangeIdentity).not.toHaveBeenCalled();
    expect(
      nodes.some((node) => node.props.testID === "category-filters-apply"),
    ).toBe(true);
  });

  it("offers language choices for live streams", () => {
    const root = CategoryDetailView({
      onChangeIdentity: () => undefined,
      onChangeQuery: () => undefined,
      onOpenAccounts: () => undefined,
      query: "",
      view: composeCategoryDetail({
        identity: defaultCategoryRequest(chatting, "all", "all"),
        loading: false,
        twitch: fixtureOutcome("twitch", "ready"),
      }),
    });
    const nodes = descendants(root);
    const language = nodes.find(
      (node) => node.props.testID === "category-language",
    );
    expect(language?.props.options).toContainEqual({
      label: "All languages",
      value: "all",
    });
    expect(language?.props.options).toContainEqual({
      label: "English",
      value: "en",
    });
  });
});
