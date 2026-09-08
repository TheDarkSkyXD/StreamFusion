import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { resolve } from "node:path";

// Pure fixture-model checks, not a browser, layout, focus or native app test.
const html = readFileSync(
  resolve(import.meta.dirname, "prototypes/android-navigation-prototype.html"),
  "utf8",
);
const script = [
  ...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
].at(-1)[1];
const normalized = script.replaceAll("\r\n", "\n");
const end = normalized.lastIndexOf(
  '      document\n        .getElementById("previous-variant")',
);
assert(end > 0);
const context = vm.createContext({
  URLSearchParams,
  location: { search: "?variant=B" },
  console,
});
vm.runInContext(
  normalized.slice(0, end) + "\nrenderApp = () => {}; updateUrl = () => {};",
  context,
);
const result = vm.runInContext(
  `(() => {
  const checks = [];
  const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  for (const scenario of reviewScenarios) {
    state.screen = scenario.screen;
    Object.assign(state, scenario.patch);
    check(typeof renderScreen() === "string" && renderScreen().length > 0, "render fixture " + scenario.id);
  }
  check(reviewScenarios.length === 67, "67 review scenarios");
  const previousPaused = state.playerPaused;
  handleAction("player-play-pause", {});
  check(state.playerPaused !== previousPaused, "play/pause state");
  handleAction("player-quality", {});
  handleAction("demo-option", { value: "720p" });
  check(state.selectedQuality === "720p", "quality selection");
  handleAction("close-sheet", {});
  check(state.demoSheet === null, "sheet closes");
  handleAction("notification-permission", {});
  handleAction("demo-option", { value: "denied" });
  check(state.notificationPermission === "denied", "denied permission fixture");
  handleAction("close-sheet", {});
  handleAction("caption-model", {});
  handleAction("sheet-fixture-action", { result: "caption-install" });
  check(state.captionModel.includes("installed"), "caption installation fixture");
  handleAction("sheet-fixture-action", { result: "caption-remove" });
  check(state.captionModel.includes("removed"), "caption removal fixture");
  handleAction("multi-chat-mode", { mode: "merged" });
  check(state.multiChatMode === "merged", "merged chat mode");
  handleAction("multi-chat-channel", {});
  check(state.multiChatMode === "channel", "channel chat mode");
  state.historyCleared = false;
  state.historyRemovedTitles = [];
  handleAction("history-remove", { title: "Impossible recovery" });
  handleAction("confirm-sheet", {});
  const remainingHistory = historyScreen();
  check(!state.historyCleared, "remove one does not clear History");
  check(!remainingHistory.includes("Impossible recovery") && remainingHistory.includes("Final round highlights"), "only selected History row removed");
  const originalOrder = [...state.slotOrder];
  const originalOwner = state.audioOwner;
  handleAction("sheet-fixture-action", { result: "slot-reorder" });
  check(state.slotOrder[0] === originalOrder[1] && state.slotOrder.at(-1) === originalOrder[0], "slot reorder changes order");
  check(state.audioOwner === originalOwner, "slot reorder preserves audio owner");
  handleAction("sheet-fixture-action", { result: "slot-remove" });
  check(state.slotOrder.length === originalOrder.length - 1, "slot remove changes configuration");
  const slotMarkup = multistreamScreen();
  check((slotMarkup.match(/class="slot /g) || []).length === state.slotOrder.length, "room grid follows configured slots");
  check(slotMarkup.indexOf('data-channel="' + state.slotOrder[0] + '"') < slotMarkup.indexOf('data-channel="' + state.slotOrder[1] + '"'), "room grid follows edited order");
  handleAction("player-captions", {});
  handleAction("demo-option", { value: "caption-style" });
  check(state.screen === "settings-playback", "caption appearance route");
  handleAction("unresolved-control", { label: "Unresolved fixture" });
  check(!demoSheet().includes('data-action="confirm-sheet"'), "unresolved control has no fake confirmation");
  state.demoFeedback = '<img src=x onerror="alert(1)">';
  check(demoSheet().includes("&lt;img") && !demoSheet().includes('<img src=x'), "fixture feedback escapes HTML");
  state.activityDismissedIds = [];
  state.activityRead = false;
  state.activityTab = "all";
  const activityAll = activityScreen();
  check(activityAll.includes('data-screen="watch"') && activityAll.includes('data-screen="moderation"') && activityAll.includes('data-screen="video"') && activityAll.includes('data-screen="system"'), "Activity preserves Watch, Moderation, Video, and Diagnostics destinations");
  check((activityAll.match(/data-action="activity-dismiss-item"/g) || []).length === 4, "Activity has separate dismiss controls for completed fixtures");
  check(activityAll.includes("3 unread"), "Activity derives initial unread count from visible fixture metadata");
  handleAction("activity-tab", { tab: "channels" });
  const activityChannels = activityScreen();
  check(activityChannels.includes("NebulaNine is live") && activityChannels.includes("Moderation session needs attention") && !activityChannels.includes("Recording window ends soon"), "Channels filter keeps only channel Activity");
  handleAction("activity-clear-completed", {});
  check(state.demoSheet.copy.includes("across all Activity tabs"), "filtered clear confirmation states global Activity scope");
  handleAction("close-sheet", {});
  check(state.activityDismissedIds.length === 0 && activityScreen().includes("NebulaNine is live"), "Activity clear cancel preserves the filtered fixture and destination");
  handleAction("activity-dismiss-item", { id: "channel-live" });
  check(state.demoSheet?.kind === "activity-dismiss-item", "per-item Activity dismissal opens a confirmation");
  handleAction("close-sheet", {});
  check(state.activityDismissedIds.length === 0 && activityScreen().includes('data-screen="watch"'), "per-item dismissal cancel retains the row and Watch destination");
  handleAction("activity-dismiss-item", { id: "channel-live" });
  handleAction("confirm-sheet", {});
  const activityChannelsAfterItemDismissal = activityScreen();
  check(!activityChannelsAfterItemDismissal.includes("NebulaNine is live") && activityChannelsAfterItemDismissal.includes("Moderation session needs attention"), "per-item dismissal removes only the selected completed row");
  check(activityUnreadCount() === 2, "per-item dismissal removes only the selected unread contribution");
  state.activityDismissedIds = [];
  state.activityRead = false;
  handleAction("activity-clear-completed", {});
  handleAction("confirm-sheet", {});
  handleAction("activity-tab", { tab: "jobs" });
  const activityJobsAfterClear = activityScreen();
  check(activityJobsAfterClear.includes("Recording window ends soon") && !activityJobsAfterClear.includes("Video download completed"), "global clear hides completed rows while retaining the active job in Jobs");
  check(!activityJobsAfterClear.includes('data-id="job-recording"'), "active job has no dismiss control");
  for (const value of ["shield-mode", "automod", "blocked-terms", "stream-info", "automod-queue", "suspicious-users", "community", "whispers", "rewards", "native-tools"]) {
    handleAction("moderation-tools", {});
    handleAction("demo-option", { value });
    check(state.demoSheet.kind.startsWith("tool-"), "channel tool " + value);
    check(demoSheet().includes("role=\\"dialog\\""), "tool sheet markup " + value);
  }
  return { count: checks.length, checks, scope: "Pure JavaScript fixture state and HTML string generation only. No browser or Android evidence." };
})()`,
  context,
  { timeout: 3000 },
);
console.log(JSON.stringify(result, null, 2));
