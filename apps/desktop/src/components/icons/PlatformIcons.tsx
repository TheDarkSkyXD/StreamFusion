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
 * 7TV Brand Mark — the official 7TV logo (three angled "7TV" letterforms).
 * Path geometry is 7TV's own brand asset (7tv.app), not KickTalk's; we're
 * intentionally rendering the same recognizable mark KickTalk uses so the
 * emote-picker button looks identical across the two apps. The viewBox is
 * 156×114 to preserve the source asset's aspect ratio — the `size` prop
 * still scales the rendered box uniformly.
 */
export function SevenTVIcon({ className, size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 156 114"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M118.551 31.283L125.599 19.0235L129.406 12.5414L122.357 0.281829V0H84.7192L98.8158 24.5191L102.763 31.283H118.551Z"
        fill="currentColor"
      />
      <path
        d="M40.8797 113.577L83.1691 40.0199L88.3846 31.0014L74.288 6.48225L70.3411 0.141113H10.8543L3.80604 12.4007L0 18.8827L7.04823 31.1423V31.4241H52.1569L16.9157 92.7219L11.982 101.459L19.0302 113.718V114H40.8797"
        fill="currentColor"
      />
      <path
        d="M99.8028 113.576H121.37L149.563 64.5382L154.497 56.0837L147.449 43.8241V43.5422H125.74L111.644 68.0614L110.657 69.8934L96.5605 45.3742L95.5742 43.5422L81.4776 68.0614L77.5308 74.825L98.6753 111.604L99.8028 113.576Z"
        fill="currentColor"
      />
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
