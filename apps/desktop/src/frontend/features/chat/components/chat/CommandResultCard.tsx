import { useTranslation } from "react-i18next";
import { LuTriangleAlert, LuX } from "react-icons/lu";

import type { ChatCommandResult } from "../../utils/chat-command-outcome";

export function CommandResultCard({
  result,
  onDismiss,
}: {
  readonly result: ChatCommandResult;
  readonly onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const isError = result.tone === "error";

  return (
    <section
      aria-atomic="true"
      aria-live="polite"
      className={`mb-1 rounded-md border bg-[#252525] px-3 py-2 text-white ${
        isError ? "border-[#dc143c]" : "border-[#333333]"
      }`}
      data-testid="chat-command-result"
      role="status"
    >
      <div className="flex items-start gap-2">
        {isError ? (
          <LuTriangleAlert
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#dc143c]"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold leading-5">{result.title}</h3>
          <p className="whitespace-pre-wrap break-words text-xs font-medium leading-5 text-[#a0a0a0]">
            {result.body}
          </p>
        </div>
        <button
          aria-label={t("chat.dismissCommandResult")}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[4px] text-[#a0a0a0] transition-colors duration-150 hover:bg-[#2d2d2d] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onClick={onDismiss}
          type="button"
        >
          <LuX aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
