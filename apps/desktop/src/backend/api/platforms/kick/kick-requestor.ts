export type KickAuthMode = "user" | "app";

export interface KickRequestor {
  request<T>(endpoint: string, options?: RequestInit, authMode?: KickAuthMode): Promise<T>;
  isAuthenticated(): boolean;
  baseUrl: string;

  // Some endpoints need to call other public methods of the client (e.g. search uses getPublicChannel)
  // We can add them here if necessary, or keep them decoupled.
  // For now, let's try to keep endpoints pure or self-contained,
  // or specifically pass the dependencies they need.
}
