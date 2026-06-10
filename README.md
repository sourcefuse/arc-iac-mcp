# ARC IaC MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI assistants direct access to [SourceFuse ARC](https://registry.terraform.io/namespaces/sourcefuse) Terraform modules. Browse, search, scaffold, compare, and security-scan any of the 56 ARC modules — all from natural language.

**Live endpoint:** `https://mcp-theta-silk.vercel.app/mcp`

---

## Quick Start

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "arc-iac": {
      "url": "https://mcp-theta-silk.vercel.app/mcp"
    }
  }
}
```

Restart Claude Desktop.

### Claude Code CLI

```bash
claude mcp add arc-iac --transport http https://mcp-theta-silk.vercel.app/mcp
```

Or add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "arc-iac": {
      "type": "http",
      "url": "https://mcp-theta-silk.vercel.app/mcp"
    }
  }
}
```

### Kiro

**User-level** (`~/.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "arc-iac": {
      "url": "https://mcp-theta-silk.vercel.app/mcp",
      "autoApprove": ["*"],
      "disabled": false
    }
  }
}
```

**Project-level** (`.kiro/settings/mcp.json` in your repo — shared with team automatically):

```json
{
  "mcpServers": {
    "arc-iac": {
      "url": "https://mcp-theta-silk.vercel.app/mcp",
      "autoApprove": ["*"]
    }
  }
}
```

### Cursor / Windsurf

`.cursor/mcp.json` or `.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "arc-iac": {
      "url": "https://mcp-theta-silk.vercel.app/mcp"
    }
  }
}
```

---

## Tools Reference

All tools use the module **short name** (e.g. `arc-eks`, not `terraform-aws-arc-eks`).

---

### `arc_list_modules`

Lists all 56 SourceFuse ARC modules with name, description, download count, and latest version.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sort` | `"downloads" \| "name"` | No | Sort order. Omit for default Registry order. |

**Example prompt:** *"List all ARC modules sorted by downloads"*

---

### `arc_search_modules`

Full-text search across module names and descriptions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | `string` | Yes | Search keyword e.g. `eks`, `load balancer`, `kafka` |

**Example prompt:** *"Search for ARC modules related to networking"*

---

### `arc_get_module`

Full detail for one module: all inputs, outputs, AWS resources it creates, and version list. README is excluded by default to keep response size manageable.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Module short name e.g. `arc-eks` |
| `include_readme` | `boolean` | No | Include the full README text. Defaults to `false`. |

**Example prompt:** *"Show me full details for arc-network"*

---

### `arc_get_inputs`

Returns only the input variables for a module. Each input includes `name`, `type`, `description`, `default`, and `required`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Module short name |

**Example prompt:** *"What inputs does arc-eks require?"*

---

### `arc_get_outputs`

Returns the output values exported by a module.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Module short name |

**Example prompt:** *"What does arc-eks output?"*

---

### `arc_get_resources`

Lists the Terraform resources (AWS and other providers) that a module creates.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Module short name |

**Example prompt:** *"What AWS resources does arc-network create?"*

---

### `arc_get_versions`

Lists all released versions of a module. The first item is always the latest.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Module short name |

**Example prompt:** *"What versions of arc-eks are available?"*

---

### `arc_find_by_resource`

Scans the entire ARC catalog and returns all modules that provision a specific AWS resource type.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `resource` | `string` | Yes | Terraform resource type e.g. `aws_eks_cluster`, `aws_s3_bucket` |

> This tool fetches all 56 modules in parallel and may take 10–20 seconds.

**Example prompt:** *"Which ARC modules create an aws_s3_bucket?"*

---

### `arc_compare_modules`

Side-by-side diff of two modules showing which inputs, outputs, and AWS resources each has — and what they share or differ on.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `module_a` | `string` | Yes | First module short name |
| `module_b` | `string` | Yes | Second module short name |

**Example prompt:** *"Compare arc-eks and arc-ecs"*

---

### `arc_scaffold`

Generates a production-ready, multi-file Terraform module structure. The scaffold:

- **Auto-detects supporting ARC modules** — if the target module needs a VPC, KMS key, or tags, the corresponding `arc-network`, `arc-kms`, or `arc-tags` module blocks are included automatically.
- **Wires cross-references** — required inputs like `vpc_id`, `subnet_ids`, `db_subnet_group_data`, and `kms_data` are set to `module.network.*` / `module.kms.*` expressions rather than empty strings.
- **Outputs 4 separate files** — `main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Module short name |
| `instance_name` | `string` | No | Logical name for the module block. Defaults to `this`. |

**Example prompt:** *"Scaffold arc-db called aurora\_postgres"*

**Sample output structure:**

```
### main.tf
# ── Supporting ARC Modules ──────────────────────────────
module "network" {
  source  = "sourcefuse/arc-network/aws"
  version = "3.0.11"
  environment = var.environment
  ...
}

# ── Main Module ─────────────────────────────────────────
module "aurora_postgres" {
  source  = "sourcefuse/arc-db/aws"
  version = "4.0.2"
  vpc_id               = module.network.vpc_id
  db_subnet_group_data = { subnet_ids = module.network.private_subnet_ids }
  ...
}

### variables.tf
variable "environment" { ... }
variable "name"        { ... }
...

### outputs.tf
output "aurora_postgres_endpoint" { value = module.aurora_postgres.endpoint }
...

### versions.tf
terraform {
  required_version = ">= 1.3.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.0" }
  }
}
```

---

### `arc_scan_hcl`

Runs a static security scan ([tfsec](https://github.com/aquasecurity/tfsec)) on any Terraform/HCL code. Returns findings grouped by severity (CRITICAL / HIGH / MEDIUM / LOW) and an overall security score out of 100.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hcl` | `string` | Yes | Terraform/HCL code to scan |

**Example prompt:** *"Scan this Terraform before I raise a PR: `<paste HCL>`"*

**Sample output:**
```
## Security Scan — provided HCL
**Score: 90/100** | ✅ 9 passed | ❌ 1 failed

### 🟠 HIGH (1)
- **AVD-AWS-0092**: S3 encryption at rest is not enabled
```

---

### `arc_validate_module`

Combines `arc_scaffold` + `arc_scan_hcl` in one call. Generates the full multi-file scaffold and immediately runs a security scan against it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Module short name |
| `instance_name` | `string` | No | Logical instance name. Defaults to `this`. |

**Example prompt:** *"Validate arc-eks for me"*

**Returns:** The full scaffold (4 files) followed by the tfsec security report.

---

## MCP Resource

The server exposes one MCP resource AI clients can read as background context.

| URI | MIME | Description |
|-----|------|-------------|
| `arc://sourcefuse/modules` | `application/json` | Full catalog of all ARC modules from registry.terraform.io |

---

## Example Workflows

### Scaffold a full Aurora PostgreSQL stack with RDS Proxy

```
"Scaffold a production-grade Aurora PostgreSQL setup with RDS Proxy using ARC modules"
```

Calls `arc_scaffold` for `arc-db`. The tool auto-detects that `vpc_id` and `db_subnet_group_data` come from `arc-network`, fetches both modules from the Registry in parallel, and returns `main.tf` (with `module.network.*` cross-references), `variables.tf`, `outputs.tf`, and `versions.tf`.

---

### Find the right module for a task

```
"I need to set up a Kafka stream pipeline. Which ARC module should I use?"
```

Calls `arc_search_modules` with relevant keywords, returns matching modules with descriptions and download counts.

---

### Security review before a PR

```
"Scan the following Terraform before I raise a PR: <paste HCL>"
```

Calls `arc_scan_hcl`, returns a severity-grouped report with score. Ask the assistant to suggest fixes for any findings.

---

### Compare container orchestration options

```
"Compare arc-eks and arc-ecs — I need to run 10 microservices. Which is better for my use case?"
```

Calls `arc_compare_modules`, returns a structured diff of inputs/outputs/resources. The assistant reasons over the result and makes a recommendation.

---

## Architecture

```
AI Client (Claude Desktop / Claude Code / Kiro / Cursor)
        │
        │  JSON-RPC over HTTPS  (MCP Streamable HTTP)
        ▼
ARC IaC MCP Server  —  Node.js + Express  —  Vercel (serverless)
  ├── Path 1: known mcp-session-id  → reuse existing transport
  ├── Path 2: initialize request    → create session, return session ID
  └── Path 3: no session (default)  → stateless bypass, works on Vercel
        │
        ├── registry.terraform.io/v1   (module metadata, inputs, outputs)
        │     namespace: sourcefuse
        │
        └── arc-iac-scan-service       (Google Cloud Run)
              tfsec static analysis
```

**Transport:** MCP Streamable HTTP with three-path session handling — works correctly on both persistent processes and Vercel serverless functions.

**Data source:** All module data is fetched live from the public Terraform Registry. No database, no stale cache.

---

## Self-Hosting

### Vercel (recommended)

```bash
git clone https://github.com/urbanlotusai/arc-iac-mcp
cd arc-iac-mcp
npm install && npm run build
npx vercel --prod
```

Your endpoint: `https://<your-project>.vercel.app/mcp`

### Any Node.js host

```bash
git clone https://github.com/urbanlotusai/arc-iac-mcp
cd arc-iac-mcp
npm install && npm run build
PORT=3000 node dist/index.js
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | *(unset — stdio mode)* | Set to start HTTP server. Not needed on Vercel. |
| `SCAN_SERVICE_URL` | `https://arc-iac-scan-service-...run.app` | Override the tfsec scan service URL |

When `PORT` is unset and not running on Vercel, the server starts in **stdio mode** for local Claude Desktop use.

---

## Local Development

```bash
git clone https://github.com/urbanlotusai/arc-iac-mcp
cd arc-iac-mcp
npm install

# Dev mode — no build step needed
PORT=3000 npm run dev
```

Test via curl:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "arc_scaffold",
      "arguments": { "name": "arc-db", "instance_name": "aurora_postgres" }
    }
  }'
```

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Opens a browser UI at `http://localhost:5173` — invoke any tool and inspect raw JSON-RPC.

---

## Troubleshooting

**Tools list is empty / only resources show**
The client may be sending `tools/list` before `initialize`. Ensure your MCP client supports Streamable HTTP. Claude Desktop, Claude Code CLI, and Kiro all work.

**`arc_find_by_resource` is slow**
Expected — it fetches all 56 modules in parallel from the Terraform Registry. Typical time: 10–20 seconds.

**`arc_scan_hcl` / `arc_validate_module` timeout on first call**
The tfsec scan service (Google Cloud Run) may cold-start in 30–60 seconds after inactivity. Retry once — subsequent calls are fast.

---

## Module Naming

All tools accept the **short name** without prefix or provider suffix:

| ✅ Correct | ❌ Wrong |
|-----------|---------|
| `arc-eks` | `terraform-aws-arc-eks` |
| `arc-network` | `sourcefuse/arc-network/aws` |
| `arc-db` | `arc_db` |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18+ |
| Language | TypeScript 5 |
| MCP SDK | `@modelcontextprotocol/sdk` v1.29 |
| HTTP | Express 4 |
| Validation | Zod 4 |
| Data source | Terraform Registry API (public) |
| Security scan | tfsec via Google Cloud Run |
| Hosting | Vercel |

---

## Contributing

1. Fork `urbanlotusai/arc-iac-mcp`
2. `npm install && PORT=3000 npm run dev`
3. Add tools in `src/tools.ts` following the existing pattern
4. `npm run build` — must compile clean with no TypeScript errors
5. Open a pull request

All tools must handle errors gracefully using the `err()` helper and return `{ content: [{ type: 'text', text: '...' }] }`.
