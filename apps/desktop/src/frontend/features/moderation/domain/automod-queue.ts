export const AUTOMOD_QUEUE_LIMIT = 100;

export interface HeldMessage {
  id: string;
  user: string;
  text: string;
  reason: string;
}

export interface AutoModQueueState {
  messages: Array<HeldMessage & { verified: boolean }>;
  overflowed: boolean;
}

export type AutoModQueueAction =
  | { type: "hold"; message: HeldMessage }
  | { type: "remove"; id: string }
  | { type: "invalidate" }
  | { type: "reset" };

export function reduceAutoModQueue(
  state: AutoModQueueState,
  action: AutoModQueueAction
): AutoModQueueState {
  switch (action.type) {
    case "reset":
      return { messages: [], overflowed: false };
    case "invalidate":
      return {
        ...state,
        messages: state.messages.map((message) => ({ ...message, verified: false })),
      };
    case "remove":
      return { ...state, messages: state.messages.filter((message) => message.id !== action.id) };
    case "hold": {
      const existing = state.messages.find((message) => message.id === action.message.id);
      if (existing?.verified) return state;
      const messages = existing
        ? state.messages.map((message) =>
            message.id === action.message.id ? { ...action.message, verified: true } : message
          )
        : [...state.messages, { ...action.message, verified: true }];
      return {
        messages: messages.slice(-AUTOMOD_QUEUE_LIMIT),
        overflowed: state.overflowed || messages.length > AUTOMOD_QUEUE_LIMIT,
      };
    }
  }
}
