interface IconProps {
  className?: string;
  size?: number;
}

/**
 * Twitch Logo Icon (Glitch logo)
 */
export function TwitchIcon({ className, size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
    </svg>
  );
}

/**
 * Kick Logo Icon
 */
export function KickIcon({ className, size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9 3a1 1 0 0 1 1 1v3h1v-1a1 1 0 0 1 .883 -.993l.117 -.007h1v-1a1 1 0 0 1 .883 -.993l.117 -.007h6a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-1v1a1 1 0 0 1 -.883 .993l-.117 .007h-1v2h1a1 1 0 0 1 .993 .883l.007 .117v1h1a1 1 0 0 1 .993 .883l.007 .117v4a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-1h-1a1 1 0 0 1 -.993 -.883l-.007 -.117v-1h-1v3a1 1 0 0 1 -.883 .993l-.117 .007h-5a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z" />
    </svg>
  );
}

/**
 * 7TV Brand Mark — hand-rolled to avoid pulling SVG from KickTalk (GPL-3.0,
 * incompatible with this codebase). Compact "7TV" wordmark inside a rounded
 * square; matches the visual weight of the other PlatformIcons at default
 * 24×24.
 */
export function SevenTVIcon({ className, size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm4.5 3a.75.75 0 0 0 0 1.5h2.43l-2.1 5.78a.75.75 0 1 0 1.41.5l2.36-6.49A.75.75 0 0 0 11 8H7.5Zm5.25 0a.75.75 0 0 0 0 1.5h1V16a.75.75 0 0 0 1.5 0V9.5h1a.75.75 0 0 0 0-1.5h-3.5Zm4.78.27a.75.75 0 0 1 .95.48l1.07 3.21 1.07-3.21a.75.75 0 1 1 1.42.48l-1.78 5.34a.75.75 0 0 1-1.42 0L17.06 9.22a.75.75 0 0 1 .47-.95Z" />
    </svg>
  );
}

/**
 * Kick Emote Icon — alias for KickIcon kept for symmetry with the
 * NativeEmoteButton's platform-aware imports. Re-exports the same mark as
 * KickIcon so a future restyle of the emote button can swap it independently
 * without touching every call site.
 */
export function KickEmoteIcon(props: IconProps) {
  return <KickIcon {...props} />;
}
