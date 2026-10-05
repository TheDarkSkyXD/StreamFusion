export async function auditStories({ ids, accessibility = true } = {}) {
  const channel = window.__STORYBOOK_ADDONS_CHANNEL__;
  if (!channel)
    throw new Error("Run this audit inside the Storybook story iframe.");
  if (accessibility && !window.axe)
    throw new Error("Wait for the Storybook accessibility addon to load.");
  const response = await fetch("/index.json");
  if (!response.ok)
    throw new Error(`Story index returned HTTP ${response.status}.`);
  const index = await response.json();
  const stories =
    ids ??
    Object.values(index.entries)
      .filter((entry) => entry.type === "story")
      .map((entry) => entry.id);
  const results = [];

  for (const id of stories) {
    const status = await new Promise((resolve) => {
      if (
        window.__STORYBOOK_PREVIEW__?.currentSelection?.storyId === id &&
        document.querySelector("#storybook-root")?.childElementCount
      ) {
        resolve("rendered");
        return;
      }
      const timer = setTimeout(() => finish("timeout"), 8000);
      function finish(result) {
        clearTimeout(timer);
        channel.off("storyRendered", rendered);
        channel.off("storyErrored", failed);
        channel.off("storyThrewException", failed);
        channel.off("storyMissing", missing);
        resolve(result);
      }
      function rendered(storyId) {
        if (storyId === id) finish("rendered");
      }
      function failed(error) {
        finish(error?.message ?? String(error));
      }
      function missing(storyId) {
        if (storyId === id) finish("missing");
      }
      channel.on("storyRendered", rendered);
      channel.on("storyErrored", failed);
      channel.on("storyThrewException", failed);
      channel.on("storyMissing", missing);
      channel.emit("setCurrentStory", { storyId: id, viewMode: "story" });
    });
    const root = document.querySelector("#storybook-root");
    const renderedContent = Boolean(
      root?.childElementCount && root.getBoundingClientRect().height > 0,
    );
    const violations =
      status === "rendered" && accessibility
        ? (
            await window.axe.run(document.body, {
              runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
            })
          ).violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.map((node) => ({
              target: node.target,
              summary: node.failureSummary,
            })),
          }))
        : [];
    results.push({ id, status, renderedContent, violations });
  }

  return {
    viewport: { width: innerWidth, height: innerHeight },
    checked: results.length,
    failures: results.filter(
      (result) =>
        result.status !== "rendered" ||
        !result.renderedContent ||
        result.violations.length,
    ),
    results,
  };
}
