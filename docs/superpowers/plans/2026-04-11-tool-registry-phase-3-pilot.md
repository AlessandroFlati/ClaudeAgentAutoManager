# Tool Registry Phase 3 Pilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the seed-tool seeding pattern end-to-end by shipping a `loadSeedTools` function plus 10 pilot seed tools across 3 categories (`data_io`, `descriptive_stats`, `regression`), wired into `app.ts` startup, with unit tests for loader idempotency and integration tests for the primitive-input-only subset.

**Architecture:** New `seeds/` subdirectory under `packages/server/src/modules/registry/`. Contains `manifest.ts` (static list of `SeedToolDef`), `loader.ts` (`loadSeedTools` function), and `tools/{name}/` subdirectories each holding a `tool.yaml` + `tool.py`. Seeds are registered via `RegistryClient.register({ caller: 'seed' })` (sets `testsRequired: false`). Idempotency is enforced by checking `client.get(name)` before each registration call.

**Tech Stack:** TypeScript ESM (NodeNext), vitest, existing `RegistryClient` API from Phase 1+2 (`register`, `get`, `list`, `invoke`, `findProducers`, `findConsumers`). Python 3 with `pandas`, `numpy`, `scikit-learn`, `statsmodels` (user-installed; integration tests skip if absent).

**Source of truth:** `docs/superpowers/specs/2026-04-11-tool-registry-phase-3-pilot-design.md`. When this plan and the spec disagree, the spec wins.

**Test discipline:** Every task follows red-green-commit. For seed tool tasks the "failing test" is the loader unit test asserting the updated registered count; the test file already exists by Task 2 and is re-run (still green, not red) with each new tool added. Tasks 14-15 introduce new tests with the full red-green cycle. Integration tests use `describe.skipIf(!pythonAvailable() || !libsAvailable(['pandas', 'numpy']))` so CI without the scientific Python stack still passes.

**Working directory for all commands:** `C:/Users/aless/PycharmProjects/ClaudeAgentAutoManager` (repository root). Run tests with `(cd packages/server && npx vitest run <path>)`.

---

## Task 1: Scaffold the `seeds/` directory tree with stub files

**Files:**
- Create: `packages/server/src/modules/registry/seeds/manifest.ts`
- Create: `packages/server/src/modules/registry/seeds/loader.ts`
- Create: `packages/server/src/modules/registry/seeds/index.ts`
- Create: `packages/server/src/modules/registry/seeds/tools/.gitkeep`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p packages/server/src/modules/registry/seeds/tools
mkdir -p packages/server/src/modules/registry/seeds/__tests__/fixtures
```

- [ ] **Step 2: Write `seeds/manifest.ts` with empty list**

`packages/server/src/modules/registry/seeds/manifest.ts`:

```typescript
// Seed tool manifest for Plurics Tool Registry Phase 3 pilot.
// Each entry provides the tool name (used for idempotency checks) and the
// relative path from this file to the tool's tool.yaml.

export interface SeedToolDef {
  name: string;    // Must match the `name` field in the corresponding tool.yaml
  relPath: string; // Relative path from this file to tool.yaml
}

export const SEED_TOOLS: SeedToolDef[] = [];
```

- [ ] **Step 3: Write `seeds/loader.ts` stub**

`packages/server/src/modules/registry/seeds/loader.ts`:

```typescript
import { RegistryClient } from '../registry-client.js';

export interface SeedLoadResult {
  registered: number;
  skipped: number;
  failed: number;
  errors: Array<{ name: string; error: string }>;
}

// Stub implementation — no tools in manifest yet.
// Will be replaced in Task 3.
export async function loadSeedTools(_client: RegistryClient): Promise<SeedLoadResult> {
  return { registered: 0, skipped: 0, failed: 0, errors: [] };
}
```

- [ ] **Step 4: Write `seeds/index.ts`**

`packages/server/src/modules/registry/seeds/index.ts`:

```typescript
export { loadSeedTools } from './loader.js';
export type { SeedLoadResult } from './loader.js';
export type { SeedToolDef } from './manifest.js';
```

- [ ] **Step 5: Add `.gitkeep` so git tracks the tools directory before any tools exist**

```bash
touch packages/server/src/modules/registry/seeds/tools/.gitkeep
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
(cd packages/server && npx tsc --noEmit)
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/seeds/
git commit -m "registry/seeds: scaffold seeds directory with manifest and loader stubs"
```

---

## Task 2: Write the loader unit test (against empty manifest — passes immediately)

**Files:**
- Create: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

This test is written against the empty manifest. It passes immediately (green). As tools are added in Tasks 4–13, the test is updated in-place to assert higher registered counts and richer assertions. This means for tasks 4-13 the "red" step is updating the expected count before adding the tool.

- [ ] **Step 1: Write the initial loader unit test**

`packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryClient } from '../../registry-client.js';
import { loadSeedTools } from '../loader.js';

describe('loadSeedTools — unit (no Python required)', () => {
  let tmpRoot: string;
  let client: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-seeds-'));
    client = new RegistryClient({ rootDir: tmpRoot });
    await client.initialize();
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns zero counts when manifest is empty', async () => {
    const result = await loadSeedTools(client);
    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 1 test, 1 passed.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: add loader unit test (empty manifest baseline)"
```

---

## Task 3: Implement `loadSeedTools` with full idempotency logic

**Files:**
- Modify: `packages/server/src/modules/registry/seeds/loader.ts`

- [ ] **Step 1: Update the unit test to assert idempotency structure**

Update the `it('returns zero counts when manifest is empty')` test and add a second it-block that will exercise idempotency once tools exist (we add the skeleton now so it does not need to be re-added later):

In `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`, replace the whole describe body with:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryClient } from '../../registry-client.js';
import { loadSeedTools } from '../loader.js';

describe('loadSeedTools — unit (no Python required)', () => {
  let tmpRoot: string;
  let client: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-seeds-'));
    client = new RegistryClient({ rootDir: tmpRoot });
    await client.initialize();
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('first call registers all seed tools', async () => {
    const result = await loadSeedTools(client);
    // With empty manifest, zero registered is correct.
    // This count will be updated as tools are added in tasks 4-13.
    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('second call is a pure no-op (idempotent)', async () => {
    await loadSeedTools(client);
    const result2 = await loadSeedTools(client);
    expect(result2.registered).toBe(0);
    expect(result2.skipped).toBe(0); // also 0 because manifest is still empty
    expect(result2.failed).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it still passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed.

- [ ] **Step 3: Implement `loadSeedTools` with real logic**

Replace `packages/server/src/modules/registry/seeds/loader.ts` with:

```typescript
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
```

- [ ] **Step 4: Run the test and confirm it still passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/registry/seeds/loader.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: implement loadSeedTools with idempotency via client.get()"
```

---

## Task 4: Seed tool — `stats.mean`

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/stats.mean/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.mean/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts`
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

- [ ] **Step 1: Update the loader test to expect 1 registered (red)**

In `loader.test.ts`, change `expect(result.registered).toBe(0)` to `expect(result.registered).toBe(1)`.

Also update the idempotent test: change `expect(result2.skipped).toBe(0)` to `expect(result2.skipped).toBe(1)`.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: `AssertionError: expected 0 to be 1`.

- [ ] **Step 3: Write `tool.yaml`**

`packages/server/src/modules/registry/seeds/tools/stats.mean/tool.yaml`:

```yaml
name: stats.mean
version: 1
description: Compute the arithmetic mean of a list of numbers.
category: descriptive_stats
tags: [statistics, mean, average]
stability: stable
cost_class: trivial
author: plurics-seeds
requires: []

entry_point: tool.py:run

inputs:
  - name: values
    schema: JsonArray
    required: true
    description: List of numeric values.

outputs:
  - name: mean
    schema: Float
    description: Arithmetic mean of the input values.
```

- [ ] **Step 4: Write `tool.py`**

`packages/server/src/modules/registry/seeds/tools/stats.mean/tool.py`:

```python
def run(values):
    if not values:
        raise ValueError("values must be a non-empty list")
    return {"mean": sum(values) / len(values)}
```

- [ ] **Step 5: Add to manifest**

In `packages/server/src/modules/registry/seeds/manifest.ts`, replace `export const SEED_TOOLS: SeedToolDef[] = [];` with:

```typescript
export const SEED_TOOLS: SeedToolDef[] = [
  { name: 'stats.mean', relPath: './tools/stats.mean/tool.yaml' },
];
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed, registered=1, skipped=1 on second call.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/stats.mean/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: add stats.mean seed tool"
```

---

## Task 5: Seed tool — `stats.fft`

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/stats.fft/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.fft/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts`
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

- [ ] **Step 1: Update the loader test to expect 2 registered, 2 skipped (red)**

In `loader.test.ts`, change `expect(result.registered).toBe(1)` to `expect(result.registered).toBe(2)`.
Change `expect(result2.skipped).toBe(1)` to `expect(result2.skipped).toBe(2)`.

Also add a new assertion after the first `loadSeedTools` call in the first test:

```typescript
const fft = client.get('stats.fft');
expect(fft).not.toBeNull();
expect(fft!.outputs).toHaveLength(2);
const outNames = fft!.outputs.map((o) => o.name);
expect(outNames).toContain('frequencies');
expect(outNames).toContain('magnitudes');
const outSchemas = fft!.outputs.map((o) => o.schemaName);
expect(outSchemas).toEqual(['NumpyArray', 'NumpyArray']);
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: AssertionError on `registered` count (2 vs 1).

- [ ] **Step 3: Write `tool.yaml`**

`packages/server/src/modules/registry/seeds/tools/stats.fft/tool.yaml`:

```yaml
name: stats.fft
version: 1
description: Compute the FFT of a real-valued signal and return frequency bins and magnitudes.
category: descriptive_stats
tags: [fft, frequency, signal, numpy]
stability: stable
cost_class: low
author: plurics-seeds
requires: [numpy]

entry_point: tool.py:run

inputs:
  - name: values
    schema: JsonArray
    required: true
    description: Real-valued signal samples (list of numbers).

outputs:
  - name: frequencies
    schema: NumpyArray
    description: Frequency bin centres (Hz, assuming unit sample rate).
  - name: magnitudes
    schema: NumpyArray
    description: Magnitude spectrum (absolute value of complex FFT output).
```

- [ ] **Step 4: Write `tool.py`**

`packages/server/src/modules/registry/seeds/tools/stats.fft/tool.py`:

```python
def run(values):
    import numpy as np
    arr = np.array(values, dtype=float)
    fft_result = np.fft.fft(arr)
    frequencies = np.fft.fftfreq(len(arr))
    magnitudes = np.abs(fft_result)
    return {"frequencies": frequencies, "magnitudes": magnitudes}
```

- [ ] **Step 5: Add to manifest**

In `manifest.ts`, add to `SEED_TOOLS`:

```typescript
  { name: 'stats.fft',  relPath: './tools/stats.fft/tool.yaml' },
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/stats.fft/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: add stats.fft seed tool"
```

---

## Task 6: Seed tool — `json.load`

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/json.load/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/json.load/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts`
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

- [ ] **Step 1: Update the loader test to expect 3 registered, 3 skipped (red)**

Change `expect(result.registered).toBe(2)` to `expect(result.registered).toBe(3)`.
Change `expect(result2.skipped).toBe(2)` to `expect(result2.skipped).toBe(3)`.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: AssertionError on `registered` count.

- [ ] **Step 3: Write `tool.yaml`**

`packages/server/src/modules/registry/seeds/tools/json.load/tool.yaml`:

```yaml
name: json.load
version: 1
description: Load a JSON file from disk and return its contents as a JsonObject.
category: data_io
tags: [json, file, io, load]
stability: stable
cost_class: trivial
author: plurics-seeds
requires: []

entry_point: tool.py:run

inputs:
  - name: path
    schema: String
    required: true
    description: Absolute or relative path to the JSON file to read.

outputs:
  - name: data
    schema: JsonObject
    description: Parsed JSON contents of the file.
```

- [ ] **Step 4: Write `tool.py`**

`packages/server/src/modules/registry/seeds/tools/json.load/tool.py`:

```python
def run(path):
    import json
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {"data": data}
```

- [ ] **Step 5: Add to manifest**

```typescript
  { name: 'json.load', relPath: './tools/json.load/tool.yaml' },
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/json.load/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: add json.load seed tool"
```

---

## Task 7: Seed tool — `json.dump`

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/json.dump/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/json.dump/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts`
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

- [ ] **Step 1: Update the loader test to expect 4 registered, 4 skipped (red)**

Change `expect(result.registered).toBe(3)` to `expect(result.registered).toBe(4)`.
Change `expect(result2.skipped).toBe(3)` to `expect(result2.skipped).toBe(4)`.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: AssertionError on `registered` count.

- [ ] **Step 3: Write `tool.yaml`**

`packages/server/src/modules/registry/seeds/tools/json.dump/tool.yaml`:

```yaml
name: json.dump
version: 1
description: Serialize a JsonObject to a JSON file on disk.
category: data_io
tags: [json, file, io, write, dump]
stability: stable
cost_class: trivial
author: plurics-seeds
requires: []

entry_point: tool.py:run

inputs:
  - name: data
    schema: JsonObject
    required: true
    description: The object to serialize and write.
  - name: path
    schema: String
    required: true
    description: Destination file path (will be created or overwritten).

outputs:
  - name: written
    schema: Boolean
    description: True if the file was written successfully.
```

- [ ] **Step 4: Write `tool.py`**

`packages/server/src/modules/registry/seeds/tools/json.dump/tool.py`:

```python
def run(data, path):
    import json
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return {"written": True}
```

- [ ] **Step 5: Add to manifest**

```typescript
  { name: 'json.dump', relPath: './tools/json.dump/tool.yaml' },
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/json.dump/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: add json.dump seed tool"
```

---

## Task 8: Seed tool — `pandas.load_csv`

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/pandas.load_csv/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/pandas.load_csv/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts`
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

- [ ] **Step 1: Update the loader test to expect 5 registered, 5 skipped, and add DataFrame producer assertion (red)**

Change `expect(result.registered).toBe(4)` to `expect(result.registered).toBe(5)`.
Change `expect(result2.skipped).toBe(4)` to `expect(result2.skipped).toBe(5)`.

Add after `await loadSeedTools(client)` in the first test:

```typescript
const producers = client.findProducers('DataFrame');
const producerNames = producers.map((t) => t.name);
expect(producerNames).toContain('pandas.load_csv');
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: AssertionError on `registered` count.

- [ ] **Step 3: Write `tool.yaml`**

`packages/server/src/modules/registry/seeds/tools/pandas.load_csv/tool.yaml`:

```yaml
name: pandas.load_csv
version: 1
description: Load a CSV file from disk into a pandas DataFrame.
category: data_io
tags: [pandas, csv, file, io, load, dataframe]
stability: stable
cost_class: low
author: plurics-seeds
requires: [pandas, numpy]

entry_point: tool.py:run

inputs:
  - name: path
    schema: String
    required: true
    description: Absolute or relative path to the CSV file.

outputs:
  - name: df
    schema: DataFrame
    description: The loaded pandas DataFrame.
```

- [ ] **Step 4: Write `tool.py`**

`packages/server/src/modules/registry/seeds/tools/pandas.load_csv/tool.py`:

```python
def run(path):
    import pandas as pd
    df = pd.read_csv(path)
    return {"df": df}
```

- [ ] **Step 5: Add to manifest**

```typescript
  { name: 'pandas.load_csv', relPath: './tools/pandas.load_csv/tool.yaml' },
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/pandas.load_csv/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: add pandas.load_csv seed tool"
```

---

## Task 9: Seed tool — `pandas.save_csv`

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/pandas.save_csv/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/pandas.save_csv/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts`
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

- [ ] **Step 1: Update the loader test to expect 6 registered, 6 skipped, and add DataFrame consumer assertion (red)**

Change `expect(result.registered).toBe(5)` to `expect(result.registered).toBe(6)`.
Change `expect(result2.skipped).toBe(5)` to `expect(result2.skipped).toBe(6)`.

Add after `await loadSeedTools(client)` in the first test:

```typescript
const consumers = client.findConsumers('DataFrame');
const consumerNames = consumers.map((t) => t.name);
expect(consumerNames).toContain('pandas.save_csv');
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: AssertionError on `registered` count.

- [ ] **Step 3: Write `tool.yaml`**

`packages/server/src/modules/registry/seeds/tools/pandas.save_csv/tool.yaml`:

```yaml
name: pandas.save_csv
version: 1
description: Write a pandas DataFrame to a CSV file on disk.
category: data_io
tags: [pandas, csv, file, io, write, dataframe]
stability: stable
cost_class: low
author: plurics-seeds
requires: [pandas, numpy]

entry_point: tool.py:run

inputs:
  - name: df
    schema: DataFrame
    required: true
    description: The DataFrame to write.
  - name: path
    schema: String
    required: true
    description: Destination file path (will be created or overwritten).

outputs:
  - name: written
    schema: Boolean
    description: True if the file was written successfully.
```

- [ ] **Step 4: Write `tool.py`**

`packages/server/src/modules/registry/seeds/tools/pandas.save_csv/tool.py`:

```python
def run(df, path):
    import pandas as pd
    df.to_csv(path, index=False)
    return {"written": True}
```

- [ ] **Step 5: Add to manifest**

```typescript
  { name: 'pandas.save_csv', relPath: './tools/pandas.save_csv/tool.yaml' },
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/pandas.save_csv/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: add pandas.save_csv seed tool"
```

---

## Task 10: Seed tool — `stats.describe`

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/stats.describe/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.describe/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts`
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

- [ ] **Step 1: Update the loader test to expect 7 registered, 7 skipped (red)**

Change `expect(result.registered).toBe(6)` to `expect(result.registered).toBe(7)`.
Change `expect(result2.skipped).toBe(6)` to `expect(result2.skipped).toBe(7)`.

Add after `await loadSeedTools(client)` in the first test:

```typescript
const dfConsumers = client.findConsumers('DataFrame').map((t) => t.name);
expect(dfConsumers).toContain('stats.describe');
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: AssertionError on `registered` count.

- [ ] **Step 3: Write `tool.yaml`**

`packages/server/src/modules/registry/seeds/tools/stats.describe/tool.yaml`:

```yaml
name: stats.describe
version: 1
description: Compute descriptive statistics for each numeric column in a DataFrame.
category: descriptive_stats
tags: [statistics, describe, summary, pandas, dataframe]
stability: stable
cost_class: low
author: plurics-seeds
requires: [pandas, numpy]

entry_point: tool.py:run

inputs:
  - name: df
    schema: DataFrame
    required: true
    description: Input DataFrame to summarise.

outputs:
  - name: summary
    schema: JsonObject
    description: Descriptive statistics as a nested dict (column -> stat -> value).
```

- [ ] **Step 4: Write `tool.py`**

`packages/server/src/modules/registry/seeds/tools/stats.describe/tool.py`:

```python
def run(df):
    import pandas as pd
    summary = df.describe().to_dict()
    return {"summary": summary}
```

- [ ] **Step 5: Add to manifest**

```typescript
  { name: 'stats.describe', relPath: './tools/stats.describe/tool.yaml' },
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/stats.describe/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: add stats.describe seed tool"
```

---

## Task 11: Seed tool — `stats.correlation_matrix`

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/stats.correlation_matrix/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/stats.correlation_matrix/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts`
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

- [ ] **Step 1: Update the loader test to expect 8 registered, 8 skipped (red)**

Change `expect(result.registered).toBe(7)` to `expect(result.registered).toBe(8)`.
Change `expect(result2.skipped).toBe(7)` to `expect(result2.skipped).toBe(8)`.

Add:

```typescript
const dfConsumers2 = client.findConsumers('DataFrame').map((t) => t.name);
expect(dfConsumers2).toContain('stats.correlation_matrix');
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: AssertionError on `registered` count.

- [ ] **Step 3: Write `tool.yaml`**

`packages/server/src/modules/registry/seeds/tools/stats.correlation_matrix/tool.yaml`:

```yaml
name: stats.correlation_matrix
version: 1
description: Compute the Pearson correlation matrix for all numeric columns in a DataFrame.
category: descriptive_stats
tags: [statistics, correlation, matrix, pandas, numpy, dataframe]
stability: stable
cost_class: low
author: plurics-seeds
requires: [pandas, numpy]

entry_point: tool.py:run

inputs:
  - name: df
    schema: DataFrame
    required: true
    description: Input DataFrame (numeric columns only are used).

outputs:
  - name: matrix
    schema: NumpyArray
    description: Correlation matrix as a 2-D numpy array.
```

- [ ] **Step 4: Write `tool.py`**

`packages/server/src/modules/registry/seeds/tools/stats.correlation_matrix/tool.py`:

```python
def run(df):
    import numpy as np
    matrix = df.corr(numeric_only=True).to_numpy()
    return {"matrix": matrix}
```

- [ ] **Step 5: Add to manifest**

```typescript
  { name: 'stats.correlation_matrix', relPath: './tools/stats.correlation_matrix/tool.yaml' },
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/stats.correlation_matrix/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: add stats.correlation_matrix seed tool"
```

---

## Task 12: Seed tool — `sklearn.linear_regression`

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.linear_regression/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/sklearn.linear_regression/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts`
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

- [ ] **Step 1: Update the loader test to expect 9 registered, 9 skipped (red)**

Change `expect(result.registered).toBe(8)` to `expect(result.registered).toBe(9)`.
Change `expect(result2.skipped).toBe(8)` to `expect(result2.skipped).toBe(9)`.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: AssertionError on `registered` count.

- [ ] **Step 3: Write `tool.yaml`**

`packages/server/src/modules/registry/seeds/tools/sklearn.linear_regression/tool.yaml`:

```yaml
name: sklearn.linear_regression
version: 1
description: Fit an OLS linear regression model using scikit-learn and return coefficients, intercept, and R-squared.
category: regression
tags: [regression, linear, sklearn, scikit-learn, numpy]
stability: stable
cost_class: low
author: plurics-seeds
requires: [numpy, scikit-learn]

entry_point: tool.py:run

inputs:
  - name: X
    schema: NumpyArray
    required: true
    description: Feature matrix of shape (n_samples, n_features).
  - name: y
    schema: NumpyArray
    required: true
    description: Target vector of shape (n_samples,).

outputs:
  - name: coefficients
    schema: NumpyArray
    description: Fitted regression coefficients, one per feature.
  - name: intercept
    schema: Float
    description: Fitted intercept term.
  - name: r_squared
    schema: Float
    description: Coefficient of determination (R^2) on the training data.
```

- [ ] **Step 4: Write `tool.py`**

`packages/server/src/modules/registry/seeds/tools/sklearn.linear_regression/tool.py`:

```python
def run(X, y):
    import numpy as np
    from sklearn.linear_model import LinearRegression
    model = LinearRegression()
    model.fit(X, y)
    r_squared = float(model.score(X, y))
    return {
        "coefficients": model.coef_,
        "intercept": float(model.intercept_),
        "r_squared": r_squared,
    }
```

- [ ] **Step 5: Add to manifest**

```typescript
  { name: 'sklearn.linear_regression', relPath: './tools/sklearn.linear_regression/tool.yaml' },
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/sklearn.linear_regression/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: add sklearn.linear_regression seed tool"
```

---

## Task 13: Seed tool — `statsmodels.ols` (final tool; full idempotency assertions)

**Files:**
- Create: `packages/server/src/modules/registry/seeds/tools/statsmodels.ols/tool.yaml`
- Create: `packages/server/src/modules/registry/seeds/tools/statsmodels.ols/tool.py`
- Modify: `packages/server/src/modules/registry/seeds/manifest.ts`
- Modify: `packages/server/src/modules/registry/seeds/__tests__/loader.test.ts`

- [ ] **Step 1: Update the loader test to expect 10 registered; add final comprehensive assertions (red)**

Replace the registered/skipped expected values and expand the assertions to the full set from the spec. The final `loader.test.ts` first describe body should look like this (replace the entire describe block):

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RegistryClient } from '../../registry-client.js';
import { loadSeedTools } from '../loader.js';

describe('loadSeedTools — unit (no Python required)', () => {
  let tmpRoot: string;
  let client: RegistryClient;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-seeds-'));
    client = new RegistryClient({ rootDir: tmpRoot });
    await client.initialize();
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('first call registers all 10 seed tools', async () => {
    const result = await loadSeedTools(client);
    expect(result.registered).toBe(10);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);

    // All tools appear in list()
    expect(client.list().length).toBeGreaterThanOrEqual(10);

    // pandas.load_csv — single String input, DataFrame output
    const loadCsv = client.get('pandas.load_csv');
    expect(loadCsv).not.toBeNull();
    expect(loadCsv!.inputs).toHaveLength(1);
    expect(loadCsv!.inputs[0].schemaName).toBe('String');
    expect(loadCsv!.outputs[0].schemaName).toBe('DataFrame');

    // stats.fft — two NumpyArray outputs
    const fft = client.get('stats.fft');
    expect(fft).not.toBeNull();
    expect(fft!.outputs).toHaveLength(2);
    const fftOutNames = fft!.outputs.map((o) => o.name);
    expect(fftOutNames).toContain('frequencies');
    expect(fftOutNames).toContain('magnitudes');
    const fftOutSchemas = fft!.outputs.map((o) => o.schemaName);
    expect(fftOutSchemas).toEqual(['NumpyArray', 'NumpyArray']);

    // findProducers('DataFrame') includes pandas.load_csv
    const producers = client.findProducers('DataFrame').map((t) => t.name);
    expect(producers).toContain('pandas.load_csv');

    // findConsumers('DataFrame') includes the three DataFrame-input tools
    const consumers = client.findConsumers('DataFrame').map((t) => t.name);
    expect(consumers).toContain('pandas.save_csv');
    expect(consumers).toContain('stats.describe');
    expect(consumers).toContain('stats.correlation_matrix');
  });

  it('second call is a pure no-op (idempotent)', async () => {
    await loadSeedTools(client);
    const result2 = await loadSeedTools(client);
    expect(result2.registered).toBe(0);
    expect(result2.skipped).toBe(10);
    expect(result2.failed).toBe(0);
    expect(result2.errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: AssertionError — registered is 9 not 10.

- [ ] **Step 3: Write `tool.yaml`**

`packages/server/src/modules/registry/seeds/tools/statsmodels.ols/tool.yaml`:

```yaml
name: statsmodels.ols
version: 1
description: Fit an OLS linear regression model using statsmodels and return coefficients, p-values, and R-squared.
category: regression
tags: [regression, ols, statsmodels, numpy, statistics]
stability: stable
cost_class: low
author: plurics-seeds
requires: [numpy, statsmodels]

entry_point: tool.py:run

inputs:
  - name: X
    schema: NumpyArray
    required: true
    description: Feature matrix of shape (n_samples, n_features). A constant column is added automatically.
  - name: y
    schema: NumpyArray
    required: true
    description: Target vector of shape (n_samples,).

outputs:
  - name: coefficients
    schema: NumpyArray
    description: Fitted regression coefficients (including intercept as first element).
  - name: p_values
    schema: NumpyArray
    description: P-values for each coefficient.
  - name: r_squared
    schema: Float
    description: R-squared of the fitted model.
```

- [ ] **Step 4: Write `tool.py`**

`packages/server/src/modules/registry/seeds/tools/statsmodels.ols/tool.py`:

```python
def run(X, y):
    import numpy as np
    import statsmodels.api as sm
    X_with_const = sm.add_constant(X)
    model = sm.OLS(y, X_with_const).fit()
    return {
        "coefficients": np.array(model.params),
        "p_values": np.array(model.pvalues),
        "r_squared": float(model.rsquared),
    }
```

- [ ] **Step 5: Add to manifest**

Final `SEED_TOOLS` in `manifest.ts` (replace the entire array):

```typescript
export const SEED_TOOLS: SeedToolDef[] = [
  { name: 'stats.mean',                relPath: './tools/stats.mean/tool.yaml' },
  { name: 'stats.fft',                 relPath: './tools/stats.fft/tool.yaml' },
  { name: 'json.load',                 relPath: './tools/json.load/tool.yaml' },
  { name: 'json.dump',                 relPath: './tools/json.dump/tool.yaml' },
  { name: 'pandas.load_csv',           relPath: './tools/pandas.load_csv/tool.yaml' },
  { name: 'pandas.save_csv',           relPath: './tools/pandas.save_csv/tool.yaml' },
  { name: 'stats.describe',            relPath: './tools/stats.describe/tool.yaml' },
  { name: 'stats.correlation_matrix',  relPath: './tools/stats.correlation_matrix/tool.yaml' },
  { name: 'sklearn.linear_regression', relPath: './tools/sklearn.linear_regression/tool.yaml' },
  { name: 'statsmodels.ols',           relPath: './tools/statsmodels.ols/tool.yaml' },
];
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.test.ts)
```

Expected: 2 tests passed, all assertions green.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/modules/registry/seeds/tools/statsmodels.ols/ \
        packages/server/src/modules/registry/seeds/manifest.ts \
        packages/server/src/modules/registry/seeds/__tests__/loader.test.ts
git commit -m "registry/seeds: add statsmodels.ols (final seed tool); all 10 tools registered"
```

---

## Task 14: Wire `loadSeedTools` into `app.ts`

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Add the import**

At the top of `app.ts`, after the existing `RegistryClient` import, add:

```typescript
import { loadSeedTools } from './modules/registry/seeds/index.js';
```

- [ ] **Step 2: Add the `loadSeedTools` call after `toolRegistry.initialize()`**

Find the existing block in `app.ts`:

```typescript
  try {
    await toolRegistry.initialize();
    console.log('[registry] initialized');
  } catch (err) {
    console.error('[registry] initialize failed:', err);
    process.exit(1);
  }
```

Replace it with:

```typescript
  try {
    await toolRegistry.initialize();
    console.log('[registry] initialized');
  } catch (err) {
    console.error('[registry] initialize failed:', err);
    process.exit(1);
  }

  try {
    const seedResult = await loadSeedTools(toolRegistry);
    console.log(
      `[registry] Seed tools loaded: ${seedResult.registered} registered, ` +
      `${seedResult.skipped} skipped, ${seedResult.failed} failed`
    );
    if (seedResult.errors.length > 0) {
      for (const e of seedResult.errors) {
        console.warn(`[registry] Seed registration failed for ${e.name}: ${e.error}`);
      }
    }
  } catch (err) {
    console.error('[registry] loadSeedTools failed:', err);
    // Non-fatal: server continues without seeds.
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
(cd packages/server && npx tsc --noEmit)
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/app.ts
git commit -m "app: wire loadSeedTools after toolRegistry.initialize()"
```

---

## Task 15: Add primitive-input integration tests

**Files:**
- Create: `packages/server/src/modules/registry/seeds/__tests__/fixtures/sample.csv`
- Create: `packages/server/src/modules/registry/seeds/__tests__/fixtures/sample.json`
- Create: `packages/server/src/modules/registry/seeds/__tests__/loader.integration.test.ts`

- [ ] **Step 1: Write the fixture files**

`packages/server/src/modules/registry/seeds/__tests__/fixtures/sample.csv`:

```
x,y,z
1.0,2.0,3.0
4.0,5.0,6.0
7.0,8.0,9.0
10.0,11.0,12.0
13.0,14.0,15.0
```

`packages/server/src/modules/registry/seeds/__tests__/fixtures/sample.json`:

```json
{
  "key": "value",
  "n": 42,
  "tags": ["alpha", "beta"]
}
```

- [ ] **Step 2: Write the failing integration test**

`packages/server/src/modules/registry/seeds/__tests__/loader.integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RegistryClient } from '../../registry-client.js';
import { loadSeedTools } from '../loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES = path.resolve(__dirname, 'fixtures');

function pythonAvailable(): boolean {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

function libsAvailable(libs: string[]): boolean {
  if (!pythonAvailable()) return false;
  const cmd = process.platform === 'win32' ? 'python' : 'python3';
  for (const lib of libs) {
    const importName = lib === 'scikit-learn' ? 'sklearn' : lib;
    const r = spawnSync(cmd, ['-c', `import ${importName}`], { encoding: 'utf8' });
    if (r.status !== 0) return false;
  }
  return true;
}

describe.skipIf(!pythonAvailable() || !libsAvailable(['pandas', 'numpy']))(
  'loadSeedTools — primitive-input integration (requires Python + pandas + numpy)',
  () => {
    let tmpRoot: string;
    let client: RegistryClient;
    let tmpOut: string;

    beforeEach(async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-seeds-int-'));
      tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'plurics-seeds-out-'));
      client = new RegistryClient({ rootDir: tmpRoot });
      await client.initialize();
      await loadSeedTools(client);
    });

    afterEach(() => {
      client.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(tmpOut, { recursive: true, force: true });
    });

    it('pandas.load_csv — loads CSV and returns a pickle_b64 DataFrame output', async () => {
      const csvPath = path.join(FIXTURES, 'sample.csv');
      const result = await client.invoke({
        toolName: 'pandas.load_csv',
        inputs: { path: csvPath },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.outputs).toHaveProperty('df');
      const df = result.outputs['df'] as Record<string, unknown>;
      expect(df['_encoding']).toBe('pickle_b64');
      expect(df['_schema']).toBe('DataFrame');
    });

    it('json.load — loads JSON and returns a JsonObject', async () => {
      const jsonPath = path.join(FIXTURES, 'sample.json');
      const result = await client.invoke({
        toolName: 'json.load',
        inputs: { path: jsonPath },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const data = result.outputs['data'] as Record<string, unknown>;
      expect(data['key']).toBe('value');
      expect(data['n']).toBe(42);
    });

    it('json.dump — writes JSON to disk and returns written=true', async () => {
      const outPath = path.join(tmpOut, 'out.json');
      const result = await client.invoke({
        toolName: 'json.dump',
        inputs: { data: { answer: 42, label: 'test' }, path: outPath },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.outputs['written']).toBe(true);
      // Verify the file was actually written
      expect(fs.existsSync(outPath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      expect(written['answer']).toBe(42);
    });

    it('stats.mean — returns arithmetic mean of [1,2,3,4,5] = 3.0', async () => {
      const result = await client.invoke({
        toolName: 'stats.mean',
        inputs: { values: [1, 2, 3, 4, 5] },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.outputs['mean']).toBe(3.0);
    });

    it('stats.fft — returns pickle_b64 NumpyArray envelopes for frequencies and magnitudes', async () => {
      const signal = [0, 1, 0, -1, 0, 1, 0, -1];
      const result = await client.invoke({
        toolName: 'stats.fft',
        inputs: { values: signal },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      const freqs = result.outputs['frequencies'] as Record<string, unknown>;
      const mags = result.outputs['magnitudes'] as Record<string, unknown>;
      expect(freqs['_encoding']).toBe('pickle_b64');
      expect(mags['_encoding']).toBe('pickle_b64');
    });
  }
);
```

- [ ] **Step 3: Run the integration test and observe outcome**

On this machine, Python is available via `py` but `pandas`/`numpy` are not installed, so all tests will be skipped. That is the correct behaviour.

```bash
(cd packages/server && npx vitest run src/modules/registry/seeds/__tests__/loader.integration.test.ts)
```

Expected: all 5 tests skipped (or passed if libraries happen to be installed).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/modules/registry/seeds/__tests__/fixtures/ \
        packages/server/src/modules/registry/seeds/__tests__/loader.integration.test.ts
git commit -m "registry/seeds: add primitive-input integration tests with CSV/JSON fixtures"
```

---

## Task 16: Module sweep — re-exports, registry index, full test run

**Files:**
- Modify: `packages/server/src/modules/registry/index.ts`

- [ ] **Step 1: Write the failing test**

Check that `registry/index.ts` re-exports `loadSeedTools` and `SeedLoadResult`. Add a test that simply imports them:

In `packages/server/src/modules/registry/__tests__/registry-client.test.ts`, add at the top of the file (after the existing imports) a verify-import test:

```typescript
import { loadSeedTools } from '../seeds/index.js';
import type { SeedLoadResult } from '../seeds/index.js';
```

And in the test file add a trivial describe block to confirm they are callable:

```typescript
describe('seeds re-exports — smoke', () => {
  it('loadSeedTools is a function', () => {
    expect(typeof loadSeedTools).toBe('function');
  });
});
```

- [ ] **Step 2: Run to confirm it passes already (no red step needed — just verify)**

```bash
(cd packages/server && npx vitest run src/modules/registry/__tests__/registry-client.test.ts)
```

Expected: all existing tests plus the new smoke test pass.

- [ ] **Step 3: Update `registry/index.ts` to re-export seeds symbols**

Add to `packages/server/src/modules/registry/index.ts`:

```typescript
export { loadSeedTools } from './seeds/loader.js';
export type { SeedLoadResult, SeedToolDef } from './seeds/index.js';
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
(cd packages/server && npx tsc --noEmit)
```

Expected: no errors.

- [ ] **Step 5: Run the full registry test suite**

```bash
(cd packages/server && npx vitest run src/modules/registry)
```

Expected: all tests pass (integration tests skipped on machines without pandas/numpy).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/registry/index.ts \
        packages/server/src/modules/registry/__tests__/registry-client.test.ts
git commit -m "registry: re-export loadSeedTools and SeedLoadResult from registry index"
```

---

## Appendix: Invocation Constraint Summary

The 5 tools with `DataFrame` or `NumpyArray` **input** ports (`pandas.save_csv`, `stats.describe`, `stats.correlation_matrix`, `sklearn.linear_regression`, `statsmodels.ols`) are **registered** correctly but **cannot be invoked** via `RegistryClient.invoke()` in Phase 1+2. The executor rejects pickle_b64 input schemas with `validation` error `"pickle input schemas not supported in phase 1+2"`.

These tools are discoverable via `list()`, `findConsumers('DataFrame')`, `findConsumers('NumpyArray')`, and `get()`. They are not covered by invocation tests — only by the loader unit test (registration succeeds). This is intentional and documented. Invocation unblocks when Node Runtimes Phase 2 ships the value store.

The 5 invokable tools (`stats.mean`, `stats.fft`, `json.load`, `json.dump`, `pandas.load_csv`) are covered by Task 15 integration tests. Note that `pandas.load_csv` produces a `DataFrame` output which is encoded as `pickle_b64` — the output is valid and the invocation succeeds; it is only tools with pickle **inputs** that are blocked.
