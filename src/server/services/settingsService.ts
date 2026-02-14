import db from '../database';

export interface SystemSetting {
  id: number;
  setting_key: string;
  setting_value: string | null;
  setting_type: string;
  category: string;
  description: string | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

class SettingsService {
  private cache: Map<string, string | null> = new Map();
  private cacheLoaded = false;

  /**
   * Load all settings into memory cache
   */
  async loadCache(): Promise<void> {
    try {
      const rows = await db('system_settings').select('setting_key', 'setting_value');
      this.cache.clear();
      for (const row of rows) {
        this.cache.set(row.setting_key, row.setting_value);
      }
      this.cacheLoaded = true;
    } catch {
      // Table may not exist yet
    }
  }

  /**
   * Get a single setting value (uses cache)
   */
  async get(key: string, defaultValue: string = ''): Promise<string> {
    if (!this.cacheLoaded) {
      await this.loadCache();
    }
    return this.cache.get(key) ?? defaultValue;
  }

  /**
   * Get a boolean setting
   */
  async getBool(key: string, defaultValue: boolean = false): Promise<boolean> {
    const val = await this.get(key, String(defaultValue));
    return val === 'true' || val === '1';
  }

  /**
   * Get all settings, optionally filtered by category
   */
  async getAll(category?: string): Promise<SystemSetting[]> {
    let qb = db('system_settings').select('*');
    if (category) {
      qb = qb.where('category', category);
    }
    return qb.orderBy('category').orderBy('setting_key');
  }

  /**
   * Update a setting value (writes to DB and refreshes cache)
   */
  async set(key: string, value: string, userId?: number): Promise<void> {
    await db('system_settings')
      .where('setting_key', key)
      .update({
        setting_value: value,
        updated_by: userId || null,
        updated_at: db.fn.now(),
      });
    this.cache.set(key, value);
  }

  /**
   * Bulk update settings
   */
  async bulkSet(settings: Record<string, string>, userId?: number): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.set(key, value, userId);
    }
  }

  /**
   * Invalidate cache to force reload on next access
   */
  invalidateCache(): void {
    this.cache.clear();
    this.cacheLoaded = false;
  }
}

export const settingsService = new SettingsService();
export default settingsService;
