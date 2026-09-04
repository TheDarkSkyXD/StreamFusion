export type MobileRuntimeHost =
  "expo-go" | "development-client" | "standalone" | "bare";

export interface MobileAppMetadata {
  readonly name: string;
  readonly version: string;
  readonly runtimeHost: MobileRuntimeHost;
}

export interface AppMetadataReader {
  read(): MobileAppMetadata;
}
