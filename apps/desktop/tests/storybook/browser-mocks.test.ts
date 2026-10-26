import "../../.storybook/browser-mocks";
import { waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { networkStatusStore } from "@/features/settings/components/hooks/network-status-store";

it("settles desktop network status with the Storybook bridge", async () => {
  const unsubscribe = networkStatusStore.subscribe(() => {});
  try {
    await waitFor(() => {
      expect(networkStatusStore.getSnapshot()).toMatchObject({
        status: "online",
        isChecking: false,
      });
    });
  } finally {
    unsubscribe();
  }
});
