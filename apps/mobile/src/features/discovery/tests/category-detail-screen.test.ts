import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { D07_PROOF_TOKEN } from "../components/category-discovery-proof-controls";
import { CategoryDetailView } from "../components/category-detail-screen";
import { composeCategoryDetail } from "../domain/category-detail";
import {
  defaultCategoryRequest,
  type CategoryRequestIdentity,
} from "../domain/category-identity";
import { fixtureOutcome } from "../domain/discovery-fixture";

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
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: () => [true, () => undefined],
}));

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  children?: unknown;
  disabled?: boolean;
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
  it("renders Follow as explained-unavailable and stamps the D07 token", () => {
    const root = CategoryDetailView({
      onChangeIdentity: () => undefined,
      onChangeQuery: () => undefined,
      onOpenAccounts: () => undefined,
      onRetry: () => undefined,
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
      onRetry: () => undefined,
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

  it("offers typed clip sort and language picker choices", () => {
    const onChangeIdentity = vi.fn();
    const identity: CategoryRequestIdentity = {
      ...defaultCategoryRequest(chatting, "all", "all"),
      tab: "clips",
    };
    const root = CategoryDetailView({
      onChangeIdentity,
      onChangeQuery: () => undefined,
      onOpenAccounts: () => undefined,
      onRetry: () => undefined,
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
    sort?.props.onChange?.("recent");
    expect(onChangeIdentity).toHaveBeenCalledWith({
      ...identity,
      clipSort: "recent",
    });

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
    language?.props.onChange?.("en");
    expect(onChangeIdentity).toHaveBeenCalledWith({
      ...identity,
      language: "en",
    });
  });
});
