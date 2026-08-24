export interface KickRequestor {
  request<T>(endpoint: string, options?: RequestInit): Promise<T>;
  isAuthenticated(): boolean;
}
