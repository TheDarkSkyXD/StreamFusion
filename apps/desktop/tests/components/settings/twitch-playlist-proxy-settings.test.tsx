import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TwitchPlaylistProxySettingsSection } from "@/features/settings/components/settings/TwitchPlaylistProxySettingsSection";
import { useAuthStore } from "@/store/auth-store";
import { DEFAULT_USER_PREFERENCES } from "@shared/auth-types";

// Guards: proxy status renders a distinct checking state and accepts any boolean `online` field as a reachable health response.
// Guards: source status is advisory UI state, so it never writes health data into durable preferences.
// Guards: offline, empty, and restored source-list states remain distinct so an unreachable proxy is never mistaken for an empty configuration.
// Guards: source mutations preserve the ordered list shape when persisted through the preferences boundary.
describe("TwitchPlaylistProxySettingsSection", () => {
  const originalUpdatePreferences = useAuthStore.getState().updatePreferences;
  const updatePreferences = vi.fn(async (updates) => {
    const current = useAuthStore.getState().preferences;
    if (current) useAuthStore.setState({ preferences: { ...current, ...updates } });
    return { success: true } as const;
  });

  beforeEach(() => {
    updatePreferences.mockClear();
    useAuthStore.setState({
      preferences: { ...DEFAULT_USER_PREFERENCES },
      updatePreferences,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ online: false }) }))
    );
  });

  afterEach(() => {
    useAuthStore.setState({ preferences: null, updatePreferences: originalUpdatePreferences });
    vi.unstubAllGlobals();
  });

  it("shows checking first, then labels a parseable ping response as online", async () => {
    render(<TwitchPlaylistProxySettingsSection />);

    expect(screen.getAllByText("Checking").length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getAllByText("Online").length).toBeGreaterThan(0));
    expect(useAuthStore.getState().preferences?.twitchPlaylistProxy).toEqual(
      DEFAULT_USER_PREFERENCES.twitchPlaylistProxy
    );
  });

  it("shows offline when a ping response does not contain the online field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ status: "nope" }) }))
    );
    render(<TwitchPlaylistProxySettingsSection />);

    await waitFor(() => expect(screen.getAllByText("Offline").length).toBeGreaterThan(0));
  });

  it("shows offline without parsing a failed ping response", async () => {
    const json = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json }))
    );
    render(<TwitchPlaylistProxySettingsSection />);

    await waitFor(() => expect(screen.getAllByText("Offline").length).toBeGreaterThan(0));
    expect(json).not.toHaveBeenCalled();
  });

  it("restores the defaults from the empty state", async () => {
    useAuthStore.setState({
      preferences: {
        ...DEFAULT_USER_PREFERENCES,
        twitchPlaylistProxy: { enabled: true, sources: [] },
      },
    });
    render(<TwitchPlaylistProxySettingsSection />);

    expect(screen.getByText("No playlist proxy sources")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    expect(updatePreferences).toHaveBeenCalledWith({
      twitchPlaylistProxy: DEFAULT_USER_PREFERENCES.twitchPlaylistProxy,
    });
  });

  it("persists a source enablement change without replacing its ordered list", async () => {
    const firstSource = DEFAULT_USER_PREFERENCES.twitchPlaylistProxy.sources[0];
    render(<TwitchPlaylistProxySettingsSection />);

    fireEvent.click(screen.getByRole("switch", { name: `Enable ${firstSource.url}` }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    const update = updatePreferences.mock.calls[0][0];
    expect(update.twitchPlaylistProxy.sources).toHaveLength(
      DEFAULT_USER_PREFERENCES.twitchPlaylistProxy.sources.length
    );
    expect(update.twitchPlaylistProxy.sources[0]).toEqual({ ...firstSource, enabled: false });
  });

  it("persists the playlist proxy master switch independently", async () => {
    render(<TwitchPlaylistProxySettingsSection />);

    fireEvent.click(screen.getByRole("switch", { name: "Enable Twitch playlist proxy" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    expect(updatePreferences).toHaveBeenCalledWith({
      twitchPlaylistProxy: {
        ...DEFAULT_USER_PREFERENCES.twitchPlaylistProxy,
        enabled: false,
      },
    });
  });

  it("confirms before deleting a source", async () => {
    const firstSource = DEFAULT_USER_PREFERENCES.twitchPlaylistProxy.sources[0];
    render(<TwitchPlaylistProxySettingsSection />);

    fireEvent.click(screen.getByRole("button", { name: `Delete ${firstSource.url}` }));
    expect(screen.getByRole("heading", { name: "Delete playlist source?" })).toBeInTheDocument();
    expect(updatePreferences).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete source" }));

    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    const update = updatePreferences.mock.calls[0][0];
    expect(update.twitchPlaylistProxy.sources).not.toContainEqual(firstSource);
    expect(update.twitchPlaylistProxy.sources).toHaveLength(
      DEFAULT_USER_PREFERENCES.twitchPlaylistProxy.sources.length - 1
    );
  });
});
