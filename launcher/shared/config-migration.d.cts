export const CURRENT_CONFIG_VERSION: 5;

export interface ConfigMigrationOptions {
  forSetup?: boolean;
}

export function migrateRuntimeConfig(value: unknown, options?: ConfigMigrationOptions): unknown;
export function needsRuntimeConfigMigration(value: unknown): boolean;
