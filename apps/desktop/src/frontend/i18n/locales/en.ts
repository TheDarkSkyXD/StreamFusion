export const en = {
  navigation: {
    home: "Home",
    following: "Following",
    categories: "Categories",
    multiview: "MultiView",
    history: "History",
    downloads: "Downloads",
    settings: "Settings",
  },
  home: {
    failed: "Failed to load streams",
    retry: "Retry",
    browseCategories: "Browse All Categories",
    liveChannels: "Live Channels",
    providersUnavailable: "{{providers}} live channels are temporarily unavailable.",
    loading: "Loading...",
    retryLoading: "Retry loading live channels",
    loadMore: "Load more live channels",
    watch: "Watch {{channel}}",
    watchNow: "Watch now",
    mutePreview: "Mute preview",
    unmutePreview: "Unmute preview",
    showChannel: "Show {{channel}}",
    previousFeatured: "Previous featured stream",
    nextFeatured: "Next featured stream",
  },
  profile: {
    open: "Open profile menu",
    guest: "Guest",
    guestPrompt: "Connect an account for full access",
    connectedAccounts: "Connected Accounts",
    connectTwitch: "Connect Twitch",
    connectKick: "Connect Kick",
    twitchChannel: "Twitch Channel",
    kickChannel: "Kick Channel",
    channel: "Channel",
    settings: "Settings",
    logout: "Log out",
    displayLanguage: "Display language",
    disconnectTwitch: "Disconnect Twitch",
    disconnectKick: "Disconnect Kick",
  },
  settings: {
    general: "General",
    generalDescription: "Language and application preferences.",
    displayLanguage: "Display language",
    languageDescription: "Choose the language used by StreamFusion's interface.",
  },
  streamGrid: {
    empty: "No streams found",
  },
} as const;

export type TranslationCatalog = {
  [Section in keyof typeof en]: {
    [Key in keyof (typeof en)[Section]]: string;
  };
};
