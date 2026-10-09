export interface WatchSubscriptionPageOpener {
  open(input: { readonly channelLogin: string }): Promise<void>;
}
