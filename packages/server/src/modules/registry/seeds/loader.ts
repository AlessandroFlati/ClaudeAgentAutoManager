import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RegistryClient } from '../registry-client.js';
import { SEED_TOOLS } from './manifest.js';

export interface SeedLoadResult {
  registered: number;
  skipped: number;
  failed: number;
  errors: Array<{ name: string; error: string }>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadSeedTools(client: RegistryClient): Promise<SeedLoadResult> {
  let registered = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ name: string; error: string }> = [];

  for (const def of SEED_TOOLS) {
    // Idempotency check: skip if the tool is already registered.
    const existing = client.get(def.name);
    if (existing !== null) {
      skipped++;
      continue;
    }

    const manifestPath = path.resolve(__dirname, def.relPath);

    try {
      const result = await client.register({
        manifestPath,
        caller: 'seed',
      });

      if (result.success) {
        registered++;
      } else {
        failed++;
        errors.push({
          name: def.name,
          error: result.errors.map((e) => e.message).join('; '),
        });
      }
    } catch (err) {
      failed++;
      errors.push({
        name: def.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { registered, skipped, failed, errors };
}
