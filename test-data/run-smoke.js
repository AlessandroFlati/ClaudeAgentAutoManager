/**
 * Smoke test runner: validates AgentBackend abstraction end-to-end.
 * Runs a 3-node workflow touching process, claude-code, and local-llm backends.
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const WS_URL = 'ws://localhost:11001/ws';
const WORKSPACE = path.resolve(__dirname);
const YAML_PATH = path.resolve(__dirname, '..', 'workflows', 'smoke-test', 'workflow.yaml');

const yamlContent = fs.readFileSync(YAML_PATH, 'utf-8');

const ws = new WebSocket(WS_URL);
const startTime = Date.now();
let runId = null;
const elapsed = () => ((Date.now() - startTime) / 1000).toFixed(1) + 's';
const log = (p, m) => console.log(`[${elapsed()}] [${p}] ${m}`);

ws.on('open', () => {
  log('WS', 'Connected. Starting smoke test...');
  ws.send(JSON.stringify({
    type: 'workflow:start',
    yamlContent,
    workspacePath: WORKSPACE,
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  switch (msg.type) {
    case 'workflow:started':
      runId = msg.runId;
      log('WORKFLOW', `Started: ${runId} (${msg.nodeCount} nodes)`);
      for (const n of msg.nodes) log('NODE', `  ${n.name}: ${n.state}`);
      break;
    case 'workflow:node-update':
      log('NODE', `${msg.node}: ${msg.fromState} -> ${msg.toState} (${msg.event})`);
      break;
    case 'workflow:completed':
      log('WORKFLOW', `COMPLETED: ${JSON.stringify(msg.summary)}`);
      checkArtifacts();
      ws.close();
      break;
    case 'error':
      log('ERROR', msg.message);
      break;
    default:
      if (!['terminal:output', 'terminal:list', 'terminal:created', 'terminal:exited'].includes(msg.type)) {
        log('MSG', `${msg.type}`);
      }
  }
});

ws.on('error', (err) => log('WS', `Error: ${err.message}`));
ws.on('close', () => { log('WS', 'Disconnected'); process.exit(0); });

function checkArtifacts() {
  const sharedDir = path.join(WORKSPACE, '.caam', 'shared');
  console.log('\n=== ARTIFACTS ===');
  const sentence = path.join(sharedDir, 'sentence.txt');
  if (fs.existsSync(sentence)) {
    console.log(`sentence.txt: "${fs.readFileSync(sentence, 'utf-8').trim()}"`);
  } else {
    console.log('sentence.txt: MISSING');
  }

  const runDir = path.join(sharedDir, '..', 'runs', runId);
  const signalsDir = path.join(runDir, 'signals');
  if (fs.existsSync(signalsDir)) {
    console.log('\n=== SIGNALS ===');
    for (const f of fs.readdirSync(signalsDir)) {
      const content = JSON.parse(fs.readFileSync(path.join(signalsDir, f), 'utf-8'));
      console.log(`  ${f}: agent=${content.agent}, status=${content.status}, duration=${content.metrics.duration_seconds.toFixed(1)}s`);
    }
  }

  // Reviewer has no file output but logs contain the LLM completion
  const reviewerLog = path.join(runDir, 'logs', 'reviewer.log');
  if (fs.existsSync(reviewerLog)) {
    const content = fs.readFileSync(reviewerLog, 'utf-8');
    const snippet = content.slice(0, 500);
    console.log(`\n=== REVIEWER OUTPUT (first 500 chars) ===\n${snippet}`);
  }
}

// Safety timeout: 15 minutes
setTimeout(() => {
  log('TIMEOUT', '15 min');
  ws.close();
  process.exit(1);
}, 900000);

setInterval(() => {
  log('STATUS', 'alive');
}, 30000);
