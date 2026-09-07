import {
  authenticationDefaults,
  type AuthenticationStoreSchema,
} from "../../authentication/data/authentication-store-schema";

import {
  DEFAULT_USER_PREFERENCES,
  DEFAULT_WINDOW_BOUNDS,
  type UserPreferences,
} from "@shared/auth-types";

export interface ElectronStoreSchema extends AuthenticationStoreSchema {
  preferences: UserPreferences;
  lastActiveTab: string;
  windowBounds: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized: boolean;
  };
}

export const defaults: ElectronStoreSchema = {
  ...authenticationDefaults,
  preferences: DEFAULT_USER_PREFERENCES,
  lastActiveTab: "home",
  windowBounds: DEFAULT_WINDOW_BOUNDS,
};
