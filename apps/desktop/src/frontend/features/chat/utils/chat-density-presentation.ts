import type { ChatDensity } from "@shared/auth-types";

type ChatDensityPresentation = {
  framedRowClass: string;
  rowClass: string;
  rowPaddingClass: "py-0" | "py-1" | "py-3";
};

const CHAT_DENSITY_PRESENTATIONS: Record<ChatDensity, ChatDensityPresentation> = {
  compact: {
    framedRowClass: "py-0 leading-[1.2]",
    rowClass: "px-4 py-0 leading-[1.2]",
    rowPaddingClass: "py-0",
  },
  cozy: {
    framedRowClass: "py-1 leading-[22px]",
    rowClass: "px-4 py-1 leading-[22px]",
    rowPaddingClass: "py-1",
  },
  loose: {
    framedRowClass: "py-3 leading-[22px]",
    rowClass: "px-4 py-3 leading-[22px]",
    rowPaddingClass: "py-3",
  },
};

export function getChatDensityPresentation(density: ChatDensity): ChatDensityPresentation {
  return CHAT_DENSITY_PRESENTATIONS[density];
}
