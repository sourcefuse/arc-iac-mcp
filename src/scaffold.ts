import type { ModuleDetail, Input } from './registry.js';

// ─── Data source detection ───────────────────────────────────────────────────

type DataSourceKey = 'vpc' | 'subnets' | 'kms' | 'sg';

const DATA_RULES: Array<{
  pattern: RegExp;
  keys: DataSourceKey[];
  ref: string;
}> = [
  { pattern: /^vpc_id$/,                keys: ['vpc'],            ref: 'data.aws_vpc.this.id' },
  { pattern: /^subnet_ids?$/,           keys: ['vpc', 'subnets'], ref: 'data.aws_subnets.private.ids' },
  { pattern: /^vpc_config$/,            keys: ['vpc', 'subnets'], ref: '{\n    subnet_ids         = data.aws_subnets.private.ids\n    security_group_ids = [data.aws_security_group.this.id]\n  }' },
  { pattern: /^db_subnet_group_data$/,  keys: ['vpc', 'subnets'], ref: '{\n    name       = "${local.name_prefix}-db-subnet-group"\n    subnet_ids = data.aws_subnets.private.ids\n  }' },
  { pattern: /^kms_key_id$|^kms_arn$|^kms_key_arn$/, keys: ['kms'], ref: 'data.aws_kms_alias.this.target_key_arn' },
  { pattern: /^kms_data$/,              keys: ['kms'],            ref: '{ key_id = data.aws_kms_alias.this.target_key_id, key_arn = data.aws_kms_alias.this.target_key_arn }' },
  { pattern: /^security_group_ids?$/,   keys: ['sg'],             ref: '[data.aws_security_group.this.id]' },
  { pattern: /^tags$/,                  keys: [],                 ref: 'local.tags' },
];

// Extra variables injected into variables.tf when certain data sources are needed
const DATA_SOURCE_VARS: Record<DataSourceKey, Array<{ name: string; description: string; type: string }>> = {
  vpc:     [{ name: 'vpc_name',             description: 'Name tag of the existing VPC to look up.',              type: 'string' }],
  subnets: [{ name: 'subnet_tier_tag',      description: 'Value of the "Tier" tag on the private subnets (e.g. "private").', type: 'string' }],
  kms:     [{ name: 'kms_alias',            description: 'KMS key alias without the "alias/" prefix.',             type: 'string' }],
  sg:      [{ name: 'security_group_name',  description: 'Name tag of the existing security group to look up.',   type: 'string' }],
};

function detectDataSources(inputs: Input[]): Set<DataSourceKey> {
  const needed = new Set<DataSourceKey>();
  for (const input of inputs.filter(i => i.required)) {
    for (const rule of DATA_RULES) {
      if (rule.pattern.test(input.name)) {
        rule.keys.forEach(k => needed.add(k));
      }
    }
  }
  return needed;
}

function refForInput(name: string, needed: Set<DataSourceKey>): string | null {
  for (const rule of DATA_RULES) {
    if (rule.pattern.test(name)) {
      const satisfied = rule.keys.every(k => needed.has(k)) || rule.keys.length === 0;
      if (satisfied) return rule.ref;
    }
  }
  return null;
}

// ─── HCL type → Terraform type ───────────────────────────────────────────────

function tfType(hclType: string): string {
  const t = hclType.toLowerCase().trim();
  if (t.startsWith('list')) return 'list(string)';
  if (t.startsWith('map'))  return 'map(string)';
  if (t.startsWith('object') || t.startsWith('set')) return 'any';
  if (t === 'bool' || t === 'boolean') return 'bool';
  if (t === 'number') return 'number';
  return 'string';
}

// ─── File builders ────────────────────────────────────────────────────────────

function buildVersionTf(mod: ModuleDetail): string {
  const resources = mod.root?.resources ?? [];
  const needsHelm = resources.some(r => r.type.startsWith('helm_'));
  const needsK8s  = resources.some(r => r.type.startsWith('kubernetes_'));

  const lines = [
    'terraform {',
    '  required_version = ">= 1.3.0"',
    '',
    '  required_providers {',
    '    aws = {',
    '      source  = "hashicorp/aws"',
    '      version = ">= 5.0"',
    '    }',
  ];
  if (needsHelm) lines.push('    helm = {', '      source  = "hashicorp/helm"', '      version = ">= 2.0"', '    }');
  if (needsK8s)  lines.push('    kubernetes = {', '      source  = "hashicorp/kubernetes"', '      version = ">= 2.0"', '    }');
  lines.push('  }', '}');
  return lines.join('\n');
}

function buildVariablesTf(mod: ModuleDetail, needed: Set<DataSourceKey>): string {
  const blocks: string[] = [];
  const seen = new Set<string>();

  // Common variables always present
  const common = [
    { name: 'environment', description: 'Deployment environment (e.g. prod, staging, dev).', type: 'string' },
    { name: 'namespace',   description: 'Project or team namespace used as a resource name prefix.', type: 'string' },
    { name: 'region',      description: 'AWS region to deploy into.',  type: 'string' },
  ];
  for (const v of common) {
    seen.add(v.name);
    blocks.push(`variable "${v.name}" {\n  description = ${JSON.stringify(v.description)}\n  type        = ${v.type}\n}`);
  }

  // Data source lookup variables
  for (const key of (['vpc', 'subnets', 'kms', 'sg'] as DataSourceKey[])) {
    if (!needed.has(key)) continue;
    for (const v of DATA_SOURCE_VARS[key]) {
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      blocks.push(`variable "${v.name}" {\n  description = ${JSON.stringify(v.description)}\n  type        = ${v.type}\n}`);
    }
  }

  // Module-specific required inputs not already covered
  for (const input of (mod.root?.inputs ?? []).filter(i => i.required)) {
    if (refForInput(input.name, needed) || seen.has(input.name)) continue;
    seen.add(input.name);
    blocks.push([
      `variable "${input.name}" {`,
      `  description = ${JSON.stringify(input.description || input.name)}`,
      `  type        = ${tfType(input.type)}`,
      '}',
    ].join('\n'));
  }

  return blocks.join('\n\n');
}

function buildLocalsTf(): string {
  return [
    'locals {',
    '  name_prefix = "${var.namespace}-${var.environment}"',
    '',
    '  tags = {',
    '    Environment = var.environment',
    '    Namespace   = var.namespace',
    '    ManagedBy   = "terraform"',
    '  }',
    '}',
  ].join('\n');
}

function buildDataTf(needed: Set<DataSourceKey>): string {
  const blocks: string[] = [];

  if (needed.has('vpc')) {
    blocks.push([
      'data "aws_vpc" "this" {',
      '  tags = {',
      '    Name = var.vpc_name',
      '  }',
      '}',
    ].join('\n'));
  }

  if (needed.has('subnets')) {
    blocks.push([
      'data "aws_subnets" "private" {',
      '  filter {',
      '    name   = "vpc-id"',
      '    values = [data.aws_vpc.this.id]',
      '  }',
      '',
      '  tags = {',
      '    Tier = var.subnet_tier_tag',
      '  }',
      '}',
    ].join('\n'));
  }

  if (needed.has('kms')) {
    blocks.push([
      'data "aws_kms_alias" "this" {',
      '  name = "alias/${var.kms_alias}"',
      '}',
    ].join('\n'));
  }

  if (needed.has('sg')) {
    blocks.push([
      'data "aws_security_group" "this" {',
      '  vpc_id = data.aws_vpc.this.id',
      '',
      '  tags = {',
      '    Name = var.security_group_name',
      '  }',
      '}',
    ].join('\n'));
  }

  return blocks.join('\n\n');
}

function buildMainTf(mod: ModuleDetail, instanceName: string, needed: Set<DataSourceKey>): string {
  const inputs  = mod.root?.inputs ?? [];
  const required = inputs.filter(i => i.required);
  const optional = inputs.filter(i => !i.required);

  const lines: string[] = [
    `module "${instanceName}" {`,
    `  source  = "sourcefuse/${mod.name}/aws"`,
    `  version = "${mod.version}"`,
    '',
  ];

  if (required.length > 0) {
    lines.push('  # --- required ---');
    for (const i of required) {
      const ref = refForInput(i.name, needed);
      lines.push(ref ? `  ${i.name} = ${ref}` : `  ${i.name} = var.${i.name}`);
    }
    lines.push('');
  }

  if (optional.length > 0) {
    lines.push('  # --- optional (uncomment to override defaults) ---');
    for (const i of optional) {
      const def = i.default === null || i.default === undefined ? 'null'
        : typeof i.default === 'string' ? `"${i.default}"`
        : JSON.stringify(i.default);
      lines.push(`  # ${i.name} = ${def}`);
    }
    lines.push('');
  }

  lines.push('  tags = local.tags');
  lines.push('}');
  return lines.join('\n');
}

function buildOutputsTf(mod: ModuleDetail, instanceName: string): string {
  return (mod.root?.outputs ?? [])
    .map(o => [
      `output "${instanceName}_${o.name}" {`,
      `  description = ${JSON.stringify(o.description || o.name)}`,
      `  value       = module.${instanceName}.${o.name}`,
      '}',
    ].join('\n'))
    .join('\n\n');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type ScaffoldFiles = Record<string, string>;

// Canonical display order matching the spec
const FILE_ORDER = ['main.tf', 'variables.tf', 'locals.tf', 'outputs.tf', 'data.tf', 'version.tf'];

export function generateScaffold(
  mod: ModuleDetail,
  instanceName = 'this',
  // kept for API compatibility but no longer used — data sources replace supporting modules
  _supportingMods: Array<{ detail: ModuleDetail; instance: string }> = [],
): ScaffoldFiles {
  const needed = detectDataSources(mod.root?.inputs ?? []);
  const files: ScaffoldFiles = {};

  files['main.tf']      = buildMainTf(mod, instanceName, needed);
  files['variables.tf'] = buildVariablesTf(mod, needed);
  files['locals.tf']    = buildLocalsTf();
  files['version.tf']   = buildVersionTf(mod);

  const outputs = buildOutputsTf(mod, instanceName);
  if (outputs.trim()) files['outputs.tf'] = outputs;

  const data = buildDataTf(needed);
  if (data.trim()) files['data.tf'] = data;

  return files;
}

export function formatScaffoldFiles(files: ScaffoldFiles): string {
  const ordered = [
    ...FILE_ORDER.filter(f => f in files),
    ...Object.keys(files).filter(f => !FILE_ORDER.includes(f)).sort(),
  ];
  return ordered
    .map(f => `### ${f}\n\`\`\`hcl\n${files[f]}\n\`\`\``)
    .join('\n\n');
}

// Legacy export — no longer drives scaffold but kept so tools.ts compiles
export interface SupportDep { arcModule: string; instance: string; }
export function detectSupportingModules(_inputs: Input[]): SupportDep[] { return []; }
