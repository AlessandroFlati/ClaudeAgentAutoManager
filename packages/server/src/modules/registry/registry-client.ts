import type {
  RegistryClientOptions,
  SchemaDef,
  ToolRecord,
  RegistrationRequest,
  RegistrationResult,
  InvocationRequest,
  InvocationResult,
  ListFilters,
} from './types.js';
import { RegistryLayout } from './storage/filesystem.js';
import { RegistryDb } from './storage/db.js';
import { SchemaRegistry } from './schemas/schema-registry.js';
import { BUILTIN_SCHEMAS } from './schemas/builtin.js';

export class RegistryClient {
  private readonly layout: RegistryLayout;
  private readonly db: RegistryDb;
  private readonly schemas: SchemaRegistry;
  private readonly pythonPath: string | null;
  private initialized = false;

  constructor(options: RegistryClientOptions = {}) {
    this.layout = new RegistryLayout(options.rootDir);
    this.db = new RegistryDb(this.layout.dbPath);
    this.schemas = new SchemaRegistry();
    this.pythonPath = options.pythonPath ?? null;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.layout.ensureLayout();
    this.db.initialize();
    // Seed the schemas table with built-ins (idempotent — INSERT OR REPLACE).
    for (const s of BUILTIN_SCHEMAS) {
      this.db.insertSchema(s);
    }
    this.initialized = true;
  }

  close(): void {
    this.db.close();
    this.initialized = false;
  }

  listSchemas(): SchemaDef[] {
    return this.schemas.list();
  }

  getSchema(name: string): SchemaDef | null {
    return this.schemas.get(name);
  }

  // Stubs filled in by subsequent tasks.

  register(_request: RegistrationRequest): Promise<RegistrationResult> {
    throw new Error('register() not implemented');
  }

  get(_name: string, _version?: number): ToolRecord | null {
    throw new Error('get() not implemented');
  }

  getAllVersions(_name: string): ToolRecord[] {
    throw new Error('getAllVersions() not implemented');
  }

  list(_filters?: ListFilters): ToolRecord[] {
    throw new Error('list() not implemented');
  }

  findProducers(_schemaName: string): ToolRecord[] {
    throw new Error('findProducers() not implemented');
  }

  findConsumers(_schemaName: string): ToolRecord[] {
    throw new Error('findConsumers() not implemented');
  }

  invoke(_request: InvocationRequest): Promise<InvocationResult> {
    throw new Error('invoke() not implemented');
  }

  rebuildFromFilesystem(): Promise<void> {
    throw new Error('rebuildFromFilesystem() not implemented');
  }
}
