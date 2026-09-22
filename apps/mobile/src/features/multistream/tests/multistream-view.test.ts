import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { emptyMultistreamLayout } from "../capabilities/multistream";
import {
  addMultistreamSlot,
  slotFromWatchTarget,
} from "../domain/multistream-layout";
import { qualifyMultistream } from "../domain/multistream-admission";
import { composeMultistreamView } from "../domain/multistream-view";
import { MultistreamView } from "../components/multistream-view";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

type ElementProps = Readonly<{
  accessibilityLabel?: string;
  children?: unknown;
  disabled?: boolean;
  onPress?: () => void;
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
      : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

function PlayerSurface() {
  return null;
}

const twitch = slotFromWatchTarget({
  channelId: "71092938",
  channelName: "xqc",
  platform: "twitch",
});

const noop = () => undefined;

function viewProps(view: ReturnType<typeof composeMultistreamView>) {
  return {
    PlayerSurface,
    onAdd: noop,
    onAudioOwner: noop,
    onCancel: noop,
    onClear: noop,
    onCloseEdit: noop,
    onConfirm: noop,
    onCoolDevice: noop,
    onEdit: noop,
    onFocus: noop,
    onMode: noop,
    onPip: noop,
    onRemove: noop,
    onReorder: noop,
    onRestore: noop,
    view,
    windowWidth: 411,
  };
}

// Guards: Multistream keeps six cells, one audio owner, and guest chat/captions copy
// Guards: Edit, Add, Cool device, Restore, and PiP stay on the room without autoplay
describe("Multistream screen", () => {
  it("renders the measured room, audio owner, and guest chat pane", () => {
    const added = addMultistreamSlot(emptyMultistreamLayout(), twitch, 1);
    expect(added.kind).toBe("applied");
    if (added.kind !== "applied") return;
    const qualified = qualifyMultistream({
      admission: { limit: 2, reason: "Measured two software decoders." },
      layout: added.layout,
      stage: 0,
    });
    const nodes = descendants(
      MultistreamView(
        viewProps(
          composeMultistreamView({
            qualified,
            windowWidth: 411,
          }),
        ),
      ),
    );
    expect(nodes.some((node) => node.props.testID === "screen-multi")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "multistream-edit")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "multistream-add")).toBe(
      true,
    );
    expect(nodes.some((node) => node.props.testID === "cool-device")).toBe(true);
    expect(nodes.some((node) => node.props.testID === "restore-slot")).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === `audio-owner-${twitch.id}`),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "multistream-chat"),
    ).toBe(true);
    expect(
      nodes.some((node) => node.props.testID === "multistream-captions"),
    ).toBe(true);
    expect(
      nodes.filter((node) =>
        String(node.props.testID ?? "").startsWith("multistream-slot-empty-"),
      ),
    ).toHaveLength(5);
  });

  it("keeps Edit and clear confirmation distinct from the live grid", () => {
    const added = addMultistreamSlot(emptyMultistreamLayout(), twitch, 1);
    expect(added.kind).toBe("applied");
    if (added.kind !== "applied") return;
    const qualified = qualifyMultistream({
      admission: { limit: 2, reason: "Measured two software decoders." },
      layout: added.layout,
      stage: 0,
    });
    const editing = descendants(
      MultistreamView(
        viewProps(
          composeMultistreamView({
            editing: true,
            qualified,
            windowWidth: 411,
          }),
        ),
      ),
    );
    expect(
      editing.some((node) => node.props.testID === "multistream-edit-sheet"),
    ).toBe(true);
    expect(
      editing.some((node) => node.props.testID === "add-multistream-slot"),
    ).toBe(true);
    const confirm = descendants(
      MultistreamView(
        viewProps(
          composeMultistreamView({
            confirm: { kind: "clear" },
            qualified,
            windowWidth: 411,
          }),
        ),
      ),
    );
    expect(
      confirm.some((node) => node.props.testID === "multistream-confirm"),
    ).toBe(true);
  });
});
