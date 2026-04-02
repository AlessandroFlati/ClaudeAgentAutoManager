import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import { TmuxManager } from './modules/terminal/tmux-manager.js';
import { TerminalRegistry } from './modules/terminal/terminal-registry.js';
import { createWebSocketServer } from './transport/websocket.js';

const PORT = parseInt(process.env.PORT ?? '11001', 10);

const app = express();
app.use(express.json());
const server = http.createServer(app);

const tmux = new TmuxManager();
const registry = new TerminalRegistry(tmux);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/terminals', (_req, res) => {
  res.json(registry.list());
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

createWebSocketServer(server, registry);

registry.discover().then((discovered) => {
  if (discovered.length > 0) {
    console.log(`Discovered ${discovered.length} existing tmux session(s)`);
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
