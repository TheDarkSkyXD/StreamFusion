/** Cancellation prevents a pending launch; it does not close an open browser. */
export interface AccountAuthorizationLaunchSignal {
  readonly aborted: boolean;
}

export type OpenAccountAuthorization = (
  url: string,
  signal: AccountAuthorizationLaunchSignal,
) => Promise<void>;
