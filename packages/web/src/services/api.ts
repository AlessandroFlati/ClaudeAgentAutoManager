import type {
  RunSummary,
  RunFilters,
  NodeState,
  WorkflowEvent,
  FindingRecord,
  ToolSummary,
  ToolDetail,
  ToolInvocationRecord,
  RegistryCategory,
  ToolUsageSummary,
} from '../types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, options);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}

// --- Run functions ---

export function listRuns(filters?: RunFilters): Promise<RunSummary[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.workflowName) params.set('workflowName', filters.workflowName);
  const qs = params.toString();
  return request<RunSummary[]>(`/runs${qs ? `?${qs}` : ''}`);
}

export function getRun(runId: string): Promise<RunSummary> {
  return request<RunSummary>(`/runs/${runId}`);
}

export function getRunNodes(runId: string): Promise<NodeState[]> {
  return request<NodeState[]>(`/runs/${runId}/nodes`);
}

export function getRunNode(runId: string, nodeName: string): Promise<NodeState> {
  return request<NodeState>(`/runs/${runId}/nodes/${encodeURIComponent(nodeName)}`);
}

export function getRunEvents(runId: string): Promise<WorkflowEvent[]> {
  return request<WorkflowEvent[]>(`/runs/${runId}/events`);
}

export function getRunFindings(runId: string): Promise<FindingRecord[]> {
  return request<FindingRecord[]>(`/runs/${runId}/findings`);
}

export async function getFindingContent(runId: string, findingId: string): Promise<string> {
  return request<string>(`/runs/${runId}/findings/${findingId}`);
}

export async function getNodeLogs(runId: string, nodeName: string): Promise<{ stdout: string; stderr: string }> {
  return request<{ stdout: string; stderr: string }>(`/runs/${runId}/logs/${encodeURIComponent(nodeName)}`);
}

export async function getNodePurpose(runId: string, nodeName: string): Promise<string> {
  return request<string>(`/runs/${runId}/purposes/${encodeURIComponent(nodeName)}`);
}

export function startRun(body: Record<string, unknown>): Promise<RunSummary> {
  return request<RunSummary>('/runs/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function pauseRun(runId: string): Promise<void> {
  return request<void>(`/runs/${runId}/pause`, { method: 'POST' });
}

export function resumeRun(runId: string): Promise<void> {
  return request<void>(`/runs/${runId}/resume`, { method: 'POST' });
}

export function abortRun(runId: string): Promise<void> {
  return request<void>(`/runs/${runId}/abort`, { method: 'POST' });
}

// --- Registry functions ---

export function listTools(query?: string, category?: string): Promise<ToolSummary[]> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (category) params.set('category', category);
  const qs = params.toString();
  return request<ToolSummary[]>(`/registry/tools${qs ? `?${qs}` : ''}`);
}

export function getToolDetail(name: string, version: string): Promise<ToolDetail> {
  return request<ToolDetail>(`/registry/tools/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
}

export async function getToolSource(name: string, version: string): Promise<string> {
  const res = await fetch(`${BASE}/registry/tools/${encodeURIComponent(name)}/${encodeURIComponent(version)}/source`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function getToolInvocations(name: string, version: string): Promise<ToolInvocationRecord[]> {
  return request<ToolInvocationRecord[]>(`/registry/tools/${encodeURIComponent(name)}/${encodeURIComponent(version)}/invocations`);
}

export function listCategories(): Promise<RegistryCategory[]> {
  return request<RegistryCategory[]>('/registry/categories');
}

export function getRunRegistryUsage(runId: string): Promise<ToolUsageSummary[]> {
  return request<ToolUsageSummary[]>(`/runs/${runId}/registry-usage`);
}
