import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import cors from 'cors';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

function createServer(): McpServer {
  const server = new McpServer({ name: 'arc-iac', version: '1.0.0' });
  registerTools(server);
  registerResources(server);
  return server;
}

// Build the Express app — used for HTTP (Render/local) and Vercel (serverless) modes.
const app = express();
app.use(cors());
app.use(express.json());

// Session store — keeps server+transport alive across multiple HTTP requests per client.
// On serverless (Vercel) sessions are per-invocation; stateless fallback handles that.
const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

app.get('/', (_req, res) => {
  res.json({
    name: 'ARC IaC MCP Server',
    version: '1.0.0',
    description: 'SourceFuse ARC Terraform module browser — 10 tools via registry.terraform.io',
    mcp_endpoint: '/mcp',
    tools: [
      'arc_list_modules', 'arc_search_modules', 'arc_get_module',
      'arc_get_inputs', 'arc_get_outputs', 'arc_get_resources',
      'arc_get_versions', 'arc_find_by_resource', 'arc_compare_modules', 'arc_scaffold',
    ],
  });
});

app.all('/mcp', async (req, res) => {
  const server = createServer();
  const anyServer = server as any;
  const body = req.body as any;

  // STATELESS JSON-RPC HANDLER: Bypass SDK entirely for all methods
  // This avoids Accept header issues and provides fast responses
  if (req.method === 'POST' && !Array.isArray(body)) {
    // 1. Initialize
    if (body?.method === 'initialize') {
      return res.json({
        jsonrpc: "2.0",
        id: body.id || 1,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: "arc-iac",
            version: "1.0.0"
          }
        }
      });
    }

    // 2. Tool Listing
    if (body?.method === 'tools/list') {
      const registeredTools = anyServer._registeredTools || {};
      const tools = Object.entries(registeredTools).map(([name, t]: [string, any]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema?.schema || t.inputSchema || { type: "object", properties: {} }
      }));
      return res.json({ jsonrpc: "2.0", id: body.id || 1, result: { tools } });
    }

    // 3. Tool Execution
    if (body?.method === 'tools/call' && body?.params?.name) {
      const toolName = body.params.name;
      const tool = anyServer._registeredTools?.[toolName];
      if (tool) {
        try {
          const result = await tool.handler(body.params.arguments || {}, {});
          return res.json({ jsonrpc: "2.0", id: body.id || 1, result });
        } catch (err: any) {
          console.error(`[MCP Tool Error] ${toolName}:`, err);
          return res.status(500).json({
            jsonrpc: "2.0",
            id: body.id || 1,
            error: { code: -32603, message: err.message || "Internal Tool Error" }
          });
        }
      } else {
        return res.status(404).json({
          jsonrpc: "2.0",
          id: body.id || 1,
          error: { code: -32601, message: `Tool not found: ${toolName}` }
        });
      }
    }

    // 4. Resources list (if requested)
    if (body?.method === 'resources/list') {
      return res.json({
        jsonrpc: "2.0",
        id: body.id || 1,
        result: { resources: [] }
      });
    }

    // 5. Notifications/initialized - acknowledge
    if (body?.method === 'notifications/initialized') {
      return res.status(200).end();
    }
  }

  // Fallback: 404 for unsupported methods
  return res.status(404).json({
    jsonrpc: "2.0",
    id: body?.id || null,
    error: { code: -32601, message: `Method not supported: ${body?.method}` }
  });
});

app.delete('/mcp', async (_req, res) => {
  // Session cleanup - stateless mode doesn't need this, just acknowledge
  res.status(200).end();
});

// Exported for Vercel — @vercel/node uses this as the request handler.
import serverless from 'serverless-http';
export const handler = serverless(app);
export default app;

const port = process.env.PORT ? parseInt(process.env.PORT) : undefined;

if (port && !process.env.VERCEL) {
  // Persistent HTTP server (Render, local dev)
  app.listen(port, () => {
    process.stderr.write(`arc-iac MCP server running on port ${port}\n`);
    process.stderr.write(`MCP endpoint: http://localhost:${port}/mcp\n`);
  });
} else if (!port && !process.env.VERCEL) {
  // stdio mode — local Claude Desktop
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
