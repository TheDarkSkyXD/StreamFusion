import { i18n } from "@/i18n";
import { selectedModerationDevelopmentFixture } from "@/dev-relay/moderation-browser-fixtures";

export function ModerationFixtureLauncher() {
  const fixture = selectedModerationDevelopmentFixture(window.location.search);
  if (!fixture) return null;

  return (
    <div
      className="shrink-0 border-b border-neutral-700 bg-neutral-900 px-4 py-2 text-xs text-neutral-300"
      data-testid="moderation-fixture-launcher"
    >
      <span className="font-semibold text-white">
        {i18n.t("chat.developmentModerationState")}
        {fixture}.
      </span>{" "}
      {i18n.t("chat.selectARealChatUserToTestModeration")}
    </div>
  );
}
