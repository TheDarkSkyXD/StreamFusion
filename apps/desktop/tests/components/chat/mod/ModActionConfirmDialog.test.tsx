import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ModActionConfirmDialog,
  type ModActionType,
} from "@/components/chat/mod/ModActionConfirmDialog";

const ACTION_COPY: Array<{
  actionType: ModActionType;
  title: string;
  confirmLabel: string;
  descriptionFragment: string;
}> = [
  {
    actionType: "ban",
    title: "Ban user",
    confirmLabel: "Ban user",
    descriptionFragment: "Permanently remove",
  },
  {
    actionType: "timeout",
    title: "Time out user",
    confirmLabel: "Time out",
    descriptionFragment: "Silence this user",
  },
  {
    actionType: "unban",
    title: "Unban user",
    confirmLabel: "Unban user",
    descriptionFragment: "Restore this user",
  },
  {
    actionType: "delete",
    title: "Delete message",
    confirmLabel: "Delete message",
    descriptionFragment: "Remove this message",
  },
  {
    actionType: "raid",
    title: "Start raid",
    confirmLabel: "Start raid",
    descriptionFragment: "Send your viewers",
  },
  {
    actionType: "clear",
    title: "Clear chat",
    confirmLabel: "Clear chat",
    descriptionFragment: "Wipe every message",
  },
  {
    actionType: "shield",
    title: "Enable Shield Mode",
    confirmLabel: "Enable Shield Mode",
    descriptionFragment: "strict moderation preset",
  },
  {
    actionType: "commercial",
    title: "Start commercial",
    confirmLabel: "Start commercial",
    descriptionFragment: "Run an ad break",
  },
  {
    actionType: "uniqueChat",
    title: "Enable Unique Chat",
    confirmLabel: "Enable Unique Chat",
    descriptionFragment: "identical to a recent one",
  },
];

describe("ModActionConfirmDialog", () => {
  it("renders nothing when open=false", () => {
    render(
      <ModActionConfirmDialog
        open={false}
        onOpenChange={() => {}}
        actionType="ban"
        targetPreview={<span>nobody</span>}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it.each(ACTION_COPY)(
    "renders the correct title, description, and CTA label for actionType=$actionType",
    ({ actionType, title, confirmLabel, descriptionFragment }) => {
      render(
        <ModActionConfirmDialog
          open={true}
          onOpenChange={() => {}}
          actionType={actionType}
          targetPreview={<span>target</span>}
          onConfirm={() => {}}
        />,
      );
      // Heading text matches the configured title exactly.
      expect(
        screen.getByRole("heading", { name: new RegExp(`^${title}$`) }),
      ).toBeInTheDocument();
      // Primary CTA label appears as a button.
      expect(
        screen.getByRole("button", {
          name: new RegExp(`^${confirmLabel}$`),
        }),
      ).toBeInTheDocument();
      // Description prose is present.
      expect(screen.getByText(new RegExp(descriptionFragment))).toBeInTheDocument();
    },
  );

  it("renders the targetPreview content in the dialog body", () => {
    render(
      <ModActionConfirmDialog
        open={true}
        onOpenChange={() => {}}
        actionType="delete"
        targetPreview={<div data-testid="preview">Hello</div>}
        onConfirm={() => {}}
      />,
    );
    const preview = screen.getByTestId("preview");
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveTextContent("Hello");
  });

  it("clicking the primary CTA fires onConfirm with undefined when no extraSlot is provided", () => {
    const onConfirm = vi.fn();
    render(
      <ModActionConfirmDialog
        open={true}
        onOpenChange={() => {}}
        actionType="ban"
        targetPreview={<span>x</span>}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Ban user$/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("clicking the primary CTA fires onConfirm with the data lifted from extraSlot", () => {
    const onConfirm = vi.fn();
    render(
      <ModActionConfirmDialog
        open={true}
        onOpenChange={() => {}}
        actionType="timeout"
        targetPreview={<span>x</span>}
        onConfirm={onConfirm}
        extraSlot={({ onDataChange }) => (
          <button
            type="button"
            data-testid="slot-set"
            onClick={() => onDataChange({ durationSeconds: 600 })}
          >
            set
          </button>
        )}
      />,
    );
    fireEvent.click(screen.getByTestId("slot-set"));
    fireEvent.click(screen.getByRole("button", { name: /^Time out$/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ durationSeconds: 600 });
  });

  it("clicking Cancel fires onOpenChange(false) and does not fire onConfirm", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ModActionConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        actionType="ban"
        targetPreview={<span>x</span>}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables both buttons when busy=true and shows the busy label on the primary CTA", () => {
    render(
      <ModActionConfirmDialog
        open={true}
        onOpenChange={() => {}}
        actionType="ban"
        targetPreview={<span>x</span>}
        onConfirm={() => {}}
        busy={true}
      />,
    );
    const cancel = screen.getByRole("button", { name: /^Cancel$/ });
    const primary = screen.getByRole("button", { name: /^Banning…$/ });
    expect(cancel).toBeDisabled();
    expect(primary).toBeDisabled();
  });

  it("does not close itself after a successful onConfirm — parent controls open state", () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ModActionConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        actionType="delete"
        targetPreview={<span>x</span>}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Delete message$/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // The dialog never calls onOpenChange on confirm — only the parent does.
    expect(onOpenChange).not.toHaveBeenCalled();
    // And the dialog itself is still rendered (open stayed true).
    expect(
      screen.getByRole("heading", { name: /^Delete message$/ }),
    ).toBeInTheDocument();
  });

  it("renders no extra slot content between preview and footer when extraSlot is undefined", () => {
    render(
      <ModActionConfirmDialog
        open={true}
        onOpenChange={() => {}}
        actionType="unban"
        targetPreview={<span>x</span>}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByTestId("mod-action-extra-slot")).toBeNull();
  });
});
