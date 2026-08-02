import type { ReactNode } from "react";

interface ChatComposerFooterProps {
  children: ReactNode;
}

export function ChatComposerFooter({ children }: ChatComposerFooterProps) {
  return (
    <div
      className="relative z-10 w-full shrink-0 border-t border-[var(--color-border)] bg-[#191919]"
      data-testid="chat-composer-footer"
    >
      <div className="p-2">{children}</div>
    </div>
  );
}
