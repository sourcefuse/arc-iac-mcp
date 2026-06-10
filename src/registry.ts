const BASE = 'https://registry.terraform.io/v1';
const NS = 'sourcefuse';

export interface Module {
  id: string;
  name: string;
  namespace: string;
  provider: string;
  version: string;
  description: string;
  downloads: number;
  published_at: string;
  verified: boolean;
  source: string;
}

export interface Input {
  name: string;
  type: string;
  description: string;
  default: unknown;
  required: boolean;
}

export interface Output {
  name: string;
  description: string;
}

export interface Resource {
  name: string;
  type: string;
}

export interface ModuleDetail extends Module {
  root: {
    readme: string;
    inputs: Input[];
    outputs: Output[];
    resources: Resource[];
  };
  examples: Array<{ name: string; path: string }>;
  versions: string[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': 'arc-iac-mcp/1.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Registry ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export async function listAllModules(): Promise<Module[]> {
  const all: Module[] = [];
  let offset = 0;
  while (true) {
    const data = await get<{ modules: Module[]; meta: { next_offset?: number } }>(
      `/modules?namespace=${NS}&limit=100&offset=${offset}`
    );
    all.push(...(data.modules ?? []));
    if (!data.meta?.next_offset || data.modules.length === 0) break;
    offset = data.meta.next_offset;
  }
  return all;
}

export async function searchModules(q: string): Promise<Module[]> {
  const data = await get<{ modules: Module[] }>(
    `/modules?namespace=${NS}&q=${encodeURIComponent(q)}&limit=50`
  );
  return data.modules ?? [];
}

export async function getModule(name: string): Promise<ModuleDetail> {
  const mod = await get<ModuleDetail>(`/modules/${NS}/${name}/aws`);
  const verData = await get<{ modules: Array<{ versions: Array<{ version: string }> }> }>(
    `/modules/${NS}/${name}/aws/versions`
  );
  mod.versions = (verData.modules?.[0]?.versions ?? []).map((v) => v.version);
  return mod;
}

export async function getVersions(name: string): Promise<string[]> {
  const data = await get<{ modules: Array<{ versions: Array<{ version: string }> }> }>(
    `/modules/${NS}/${name}/aws/versions`
  );
  return (data.modules?.[0]?.versions ?? []).map((v) => v.version);
}
