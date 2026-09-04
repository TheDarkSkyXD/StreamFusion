import type { StoreDatabase } from "./database-contracts";

export interface ProductSetting {
  readonly key: string;
  readonly updatedAt: number;
  readonly value: string;
}

interface ProductSettingRow {
  readonly key: string;
  readonly updated_at: number;
  readonly value: string;
}

export class ProductStore {
  constructor(private readonly database: StoreDatabase) {}

  close(): Promise<void> {
    return this.database.close();
  }

  async getSetting(key: string): Promise<ProductSetting | null> {
    const row = await this.database.first<ProductSettingRow>(
      "SELECT key, value, updated_at FROM settings WHERE key = ?",
      [key],
    );
    return row
      ? { key: row.key, updatedAt: row.updated_at, value: row.value }
      : null;
  }

  async setSetting(setting: ProductSetting): Promise<void> {
    await this.database.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [setting.key, setting.value, setting.updatedAt],
    );
  }
}
