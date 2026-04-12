import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { AgentRegistry } from './modules/agents/agent-registry.js';
import { createWebSocketServer } from './transport/websocket.js';
import { getDb } from './db/database.js';
import { WorkspaceRepository } from './db/workspace-repository.js';
import { PresetRepository } from './db/preset-repository.js';
import { WorkflowRepository } from './db/workflow-repository.js';
import { AgentBootstrap } from './modules/knowledge/agent-bootstrap.js';
import { seedPresetsFromFilesystem } from './modules/workflow/preset-resolver.js';
import { resolvePluricsPath } from './modules/workflow/utils.js';
import { RegistryClient } from './modules/registry/index.js';
import { loadSeedTools } from './modules/registry/seeds/index.js';
import type { ListFilters, ToolRecord, ToolStatus } from './modules/registry/types.js';

const PORT = parseInt(process.env.PORT ?? '11001', 10);

const app = express();
app.use(express.json());
const server = http.createServer(app);

const registry = new AgentRegistry();
const bootstrap = new AgentBootstrap();
export const toolRegistry = new RegistryClient();

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/validate-path', (req, res) => {
  const { path } = req.body;
  if (!path || typeof path !== 'string') {
    res.json({ valid: false, error: 'Path is required' });
    return;
  }
  try {
    const stat = fs.statSync(path);
    if (!stat.isDirectory()) {
      res.json({ valid: false, error: 'Path is not a directory' });
      return;
    }
    res.json({ valid: true });
  } catch {
    res.json({ valid: false, error: 'Path does not exist' });
  }
});

app.get('/api/list-dirs', (req, res) => {
  const prefix = (req.query.prefix as string) || '';
  if (!prefix) {
    res.json([]);
    return;
  }
  try {
    // If prefix ends with /, list contents of that directory
    // Otherwise, list parent directory filtered by the basename prefix
    let dirToRead: string;
    let filter: string;
    if (prefix.endsWith('/') || prefix.endsWith('\\')) {
      dirToRead = prefix;
      filter = '';
    } else {
      dirToRead = path.dirname(prefix);
      filter = path.basename(prefix).toLowerCase();
    }
    const entries = fs.readdirSync(dirToRead, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .filter(e => !filter || e.name.toLowerCase().startsWith(filter))
      .slice(0, 20)
      .map(e => path.join(dirToRead, e.name));
    res.json(dirs);
  } catch {
    res.json([]);
  }
});

app.get('/api/list-files', (req, res) => {
  const dir = req.query.dir as string;
  const extensions = ((req.query.extensions as string) || '').split(',').filter(Boolean);
  if (!dir) { res.json({ files: [] }); return; }
  try {
    const files = fs.readdirSync(dir)
      .filter(f => {
        if (extensions.length === 0) return true;
        return extensions.some(ext => f.endsWith(`.${ext}`));
      })
      .map(f => {
        const stat = fs.statSync(path.join(dir, f));
        if (!stat.isFile()) return null;
        return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null && f.size > 0);
    res.json({ files });
  } catch {
    res.json({ files: [] });
  }
});

const workspaceRepo = new WorkspaceRepository(getDb());
const presetRepo = new PresetRepository(getDb());
const workflowRepo = new WorkflowRepository(getDb());

app.get('/api/workspaces', (_req, res) => {
  const workspaces = workspaceRepo.list();
  res.json(workspaces.map(w => ({
    ...w,
    agents: workspaceRepo.getAgents(w.id),
  })));
});

app.post('/api/workspaces', (req, res) => {
  try {
    const ws = workspaceRepo.create(req.body);
    res.json({ ...ws, agents: workspaceRepo.getAgents(ws.id) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create workspace' });
  }
});

app.put('/api/workspaces/:id', (req, res) => {
  workspaceRepo.update(Number(req.params.id), req.body);
  res.json({ ok: true });
});

app.delete('/api/workspaces/:id', (req, res) => {
  workspaceRepo.remove(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/workspaces/:id/select', (req, res) => {
  workspaceRepo.select(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/agent-presets', (_req, res) => {
  res.json(presetRepo.list());
});

app.post('/api/agent-presets', (req, res) => {
  try {
    const preset = presetRepo.create(req.body);
    res.json(preset);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create preset' });
  }
});

app.put('/api/agent-presets/:id', (req, res) => {
  presetRepo.update(Number(req.params.id), req.body);
  res.json({ ok: true });
});

app.delete('/api/agent-presets/:id', (req, res) => {
  presetRepo.remove(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/agent-presets/seed', (_req, res) => {
  const projectRoot = path.resolve(path.join(__dirname, '..', '..', '..'));
  const imported = seedPresetsFromFilesystem(projectRoot, presetRepo);
  res.json({ imported, total: presetRepo.list().length });
});

app.get('/api/workflows', (_req, res) => {
  res.json(workflowRepo.listRuns());
});

app.get('/api/workflows/:id', (req, res) => {
  const run = workflowRepo.getRun(req.params.id);
  if (!run) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ ...run, events: workflowRepo.getEvents(req.params.id) });
});

app.get('/api/workflows/runs/:runId/log/:agent', (req, res) => {
  // Find workspace path from workflow run
  const run = workflowRepo.getRun(req.params.runId);
  if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
  const logPath = resolvePluricsPath(run.workspace_path, 'runs', req.params.runId, 'logs', `${req.params.agent}.log`);
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).json({ error: 'Log not found' });
  }
});

app.get('/api/workflows/runs/:runId/purpose/:agent', (req, res) => {
  const run = workflowRepo.getRun(req.params.runId);
  if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
  const purposePath = resolvePluricsPath(run.workspace_path, 'runs', req.params.runId, 'purposes', `${req.params.agent}.md`);
  try {
    const content = fs.readFileSync(purposePath, 'utf-8');
    res.type('text/markdown').send(content);
  } catch {
    res.status(404).json({ error: 'Purpose not found' });
  }
});

app.get('/api/workflows/runs/:runId/metadata', (req, res) => {
  const run = workflowRepo.getRun(req.params.runId);
  if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
  const metaPath = resolvePluricsPath(run.workspace_path, 'runs', req.params.runId, 'run-metadata.json');
  try {
    const content = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    res.json(content);
  } catch {
    res.status(404).json({ error: 'Metadata not found' });
  }
});

const projectRoot = path.resolve(path.join(__dirname, '..', '..', '..'));

app.get('/api/workflow-files', (_req, res) => {
  const workflowsDir = path.join(projectRoot, 'workflows');
  try {
    const files = fs.readdirSync(workflowsDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    res.json(files);
  } catch {
    res.json([]);
  }
});

app.get('/api/workflow-files/:name', (req, res) => {
  const filePath = path.join(projectRoot, 'workflows', req.params.name);
  if (!filePath.startsWith(path.join(projectRoot, 'workflows'))) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ name: req.params.name, content, path: filePath });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

app.get('/api/workflows/runs/resumable', (_req, res) => {
  const runs = workflowRepo.listResumableRuns();
  res.json(runs.map(r => ({
    id: r.id,
    workflow_name: r.workflow_name,
    status: r.status,
    started_at: r.started_at,
    node_count: r.node_count,
    nodes_completed: r.nodes_completed,
    nodes_failed: r.nodes_failed,
  })));
});

app.get('/api/workflows/runs/:runId/findings', (req, res) => {
  const run = workflowRepo.getRun(req.params.runId);
  if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
  const findingsDir = resolvePluricsPath(run.workspace_path, 'runs', req.params.runId, 'findings');
  try {
    const files = fs.readdirSync(findingsDir).filter(f => f.endsWith('.md'));
    const findings = files.map(f => {
      const content = fs.readFileSync(path.join(findingsDir, f), 'utf-8');
      const hypothesisId = f.replace('-finding.md', '');
      return { hypothesisId, content };
    });
    res.json(findings);
  } catch {
    // Also check shared/findings (symlink may point to run dir)
    const sharedDir = resolvePluricsPath(run.workspace_path, 'shared', 'findings');
    try {
      const files = fs.readdirSync(sharedDir).filter(f => f.endsWith('.md'));
      const findings = files.map(f => {
        const content = fs.readFileSync(path.join(sharedDir, f), 'utf-8');
        const hypothesisId = f.replace('-finding.md', '');
        return { hypothesisId, content };
      });
      res.json(findings);
    } catch {
      res.json([]);
    }
  }
});

// ── Registry endpoints (Tasks 4-7) ──────────────────────────────────────────

app.get('/api/registry/tools', (req, res) => {
  const filters: ListFilters = {};
  if (req.query.category) filters.category = req.query.category as string;
  if (req.query.tags) filters.tags = (req.query.tags as string).split(',');
  if (req.query.status) filters.statusIn = [(req.query.status as string) as ToolStatus];
  const tools = toolRegistry.listTools(filters);
  const byName = new Map<string, ToolRecord>();
  const versionCount = new Map<string, number>();
  for (const t of tools) {
    const existing = byName.get(t.name);
    if (!existing || t.version > existing.version) byName.set(t.name, t);
    versionCount.set(t.name, (versionCount.get(t.name) ?? 0) + 1);
  }
  const result = [...byName.values()].map(t => ({
    name: t.name, version: t.version, description: t.description,
    category: t.category, tags: t.tags, stability: t.stability,
    costClass: t.costClass, status: t.status,
    versionCount: versionCount.get(t.name) ?? 1,
  }));
  res.json({ data: { tools: result, total: result.length } });
});

app.get('/api/registry/tools/:name', (req, res) => {
  const versions = toolRegistry.getToolsByName(req.params.name);
  if (versions.length === 0) {
    res.status(404).json({ error: { code: 'not_found', message: 'Tool not found' } }); return;
  }
  res.json({ data: { name: req.params.name, versions } });
});

app.get('/api/registry/tools/:name/:version/source', (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) { res.status(400).json({ error: { code: 'bad_request', message: 'version must be integer' } }); return; }
  const record = toolRegistry.getTool(req.params.name, version);
  if (!record) { res.status(404).json({ error: { code: 'not_found', message: 'Tool not found' } }); return; }
  const [entryFile] = record.entryPoint.split(':');
  const sourcePath = path.join(record.directory, entryFile);
  try {
    const content = fs.readFileSync(sourcePath, 'utf-8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).json({ error: { code: 'not_found', message: 'Source file not found' } });
  }
});

app.get('/api/registry/tools/:name/:version/tests', (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) { res.status(400).json({ error: { code: 'bad_request', message: 'version must be integer' } }); return; }
  const record = toolRegistry.getTool(req.params.name, version);
  if (!record) { res.status(404).json({ error: { code: 'not_found', message: 'Tool not found' } }); return; }
  const testsPath = path.join(record.directory, 'tests.py');
  try {
    const content = fs.readFileSync(testsPath, 'utf-8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).json({ error: { code: 'not_found', message: 'tests.py not found' } });
  }
});

app.post('/api/registry/tools/:name/:version/run_tests', async (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) { res.status(400).json({ error: { code: 'bad_request', message: 'version must be integer' } }); return; }
  if (!toolRegistry.getTool(req.params.name, version)) {
    res.status(404).json({ error: { code: 'not_found', message: 'Tool not found' } }); return;
  }
  try {
    const result = await toolRegistry.runTests(req.params.name, version);
    res.status(202).json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'python_unavailable') {
      res.status(503).json({ error: { code: 'python_unavailable', message: 'Python interpreter not available' } });
    } else {
      res.status(500).json({ error: { code: 'internal', message: msg } });
    }
  }
});

app.get('/api/registry/tools/:name/:version/invocations', (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) { res.status(400).json({ error: { code: 'bad_request', message: 'version must be integer' } }); return; }
  if (!toolRegistry.getTool(req.params.name, version)) {
    res.status(404).json({ error: { code: 'not_found', message: 'Tool not found' } }); return;
  }
  res.json({ data: { toolName: req.params.name, version, invocations: [], note: 'invocation logging not yet enabled' } });
});

app.get('/api/registry/tools/:name/:version', (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) { res.status(400).json({ error: { code: 'bad_request', message: 'version must be integer' } }); return; }
  const record = toolRegistry.getTool(req.params.name, version);
  if (!record) { res.status(404).json({ error: { code: 'not_found', message: 'Tool not found' } }); return; }
  res.json({ data: record });
});

app.get('/api/registry/schemas', (_req, res) => {
  const schemas = toolRegistry.listSchemas();
  res.json({ data: { schemas, total: schemas.length } });
});

app.get('/api/registry/schemas/:name', (req, res) => {
  const schema = toolRegistry.getSchema(req.params.name);
  if (!schema) { res.status(404).json({ error: { code: 'not_found', message: 'Schema not found' } }); return; }
  res.json({ data: schema });
});

app.get('/api/registry/converters', (_req, res) => {
  const converters = toolRegistry.listConverters();
  res.json({ data: { converters, total: converters.length } });
});

app.get('/api/registry/converters/:source/:target', (req, res) => {
  const converter = toolRegistry.getConverter(req.params.source, req.params.target);
  if (!converter) { res.status(404).json({ error: { code: 'not_found', message: 'Converter not found' } }); return; }
  res.json({ data: converter });
});

app.get('/api/registry/categories', (_req, res) => {
  const categories = toolRegistry.listCategories();
  res.json({ data: { categories, total: categories.length } });
});

app.get('/api/registry/search', (req, res) => {
  const q = (req.query.q as string) ?? '';
  if (q.length < 2) {
    res.status(400).json({ error: { code: 'bad_request', message: 'q must be at least 2 characters' } }); return;
  }
  const tools = toolRegistry.searchTools(q);
  const results = tools.map(t => ({
    name: t.name, version: t.version, description: t.description,
    category: t.category, tags: t.tags,
    matchedFields: ([
      t.name.includes(q) ? 'name' : null,
      t.description?.includes(q) ? 'description' : null,
      t.tags.some(tag => tag.includes(q)) ? 'tags' : null,
    ].filter(Boolean) as ('name' | 'description' | 'tags')[]),
  }));
  res.json({ data: { query: q, results, total: results.length } });
});

createWebSocketServer(server, registry, bootstrap, presetRepo, workflowRepo, projectRoot, toolRegistry);

// Auto-seed presets from filesystem on startup
const seeded = seedPresetsFromFilesystem(projectRoot, presetRepo);
if (seeded > 0) {
  console.log(`Seeded ${seeded} preset(s) from workflows/presets/`);
}

(async () => {
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

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();

const shutdown = (signal: string): void => {
  console.log(`[server] received ${signal}, shutting down`);
  try {
    toolRegistry.close();
  } catch {
    // ignore
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
