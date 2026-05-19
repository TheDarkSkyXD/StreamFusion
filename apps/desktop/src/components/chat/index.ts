/**
 * Chat Components Index
 *
 * Exports all chat-related UI components.
 * Chat components work with both Twitch and Kick chat systems.
 */

export type { ChatInputHandle, ChatInputProps } from "./ChatInput";
export { ChatInput } from "./ChatInput";
export { ChatMessage } from "./ChatMessage";
export { ChatMessageList } from "./ChatMessageList";
export type { ChatPanelProps } from "./ChatPanel";
export { ChatPanel } from "./ChatPanel";
export { EmoteAutocomplete, useEmoteAutocomplete } from "./EmoteAutocomplete";
export { EmoteImage } from "./EmoteImage";
export type { RecentChatter } from "./MentionAutocomplete";
export { MentionAutocomplete, useMentionAutocomplete } from "./MentionAutocomplete";
export { Username } from "./Username";

// Will be added in future phases
// export { ChatUserList } from './ChatUserList';
