export interface MultistreamResourceAdmission {
  read(): Promise<{
    readonly allowed: boolean;
    readonly detail: string | null;
  }>;
}
