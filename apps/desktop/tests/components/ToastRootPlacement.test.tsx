import { render } from "@testing-library/react";
import type { ToasterProps } from "sonner";
import { describe, expect, it, vi } from "vitest";

const toasterProps = vi.hoisted(() => ({
  current: undefined as ToasterProps | undefined,
}));

vi.mock("sonner", () => ({
  Toaster: (props: ToasterProps) => {
    toasterProps.current = props;
    return <div data-testid="toaster" />;
  },
}));

import { ToastRoot } from "@/components/ToastRoot";

// Guards: global toasts render top-right below the app title bar and top navbar, not over the navigation chrome.
describe("ToastRoot placement", () => {
  it("positions toast notifications below the top navigation", () => {
    render(<ToastRoot />);

    expect(toasterProps.current?.position).toBe("top-right");
    expect(toasterProps.current?.offset).toEqual({
      top: "calc(1.75rem + 3.5rem + 1rem)",
      right: "1rem",
    });
    expect(toasterProps.current?.mobileOffset).toEqual({
      top: "calc(1.75rem + 3.5rem + 1rem)",
      right: "1rem",
    });
  });
});
