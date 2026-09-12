import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { CategoryDetailView } from "../components/category-detail-screen";
import { composeCategoryDetail } from "../domain/category-detail";
import { defaultCategoryRequest } from "../domain/category-identity";
import { fixtureOutcome } from "../domain/discovery-fixture";

vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  children?: unknown;
  disabled?: boolean;
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
    expect(
      nodes.some((node) => node.props.children === "D07 category discovery proof"),
    ).toBe(true);
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
});
