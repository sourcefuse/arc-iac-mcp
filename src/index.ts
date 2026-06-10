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
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Path 1: known session — reuse transport (works for persistent processes like Render)
  if (sessionId && sessions.has(sessionId)) {
    await sessions.get(sessionId)!.transport.handleRequest(req, res, req.body);
    return;
  }

  const body = req.body as { method?: string } | Array<{ method?: string }> | undefined;
  const isInit = Array.isArray(body)
    ? body.some(m => m?.method === 'initialize')
    : body?.method === 'initialize';

  const server = createServer();

  if (isInit) {
    // Path 2: initialize — create a new session, send session ID back to client
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id: string) => { sessions.set(id, { server, transport }); },
    });
    transport.onclose = () => {
      for (const [id, s] of sessions.entries()) {
        if (s.transport === transport) { sessions.delete(id); break; }
      }
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } else {
    // Path 3: stateless fallback — no session ID or session expired (common on serverless).
    // The SDK's transport guards tool calls behind _initialized (set only after an initialize
    // exchange). Bypass it so clients that don't maintain sessions (or hit a cold instance)
    // can still call tools without re-initializing.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (transport as any)._webStandardTransport._initialized = true;
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!;
    await transport.close();
    sessions.delete(sessionId);
  }
  res.status(200).end();
});

// Exported for Vercel — @vercel/node uses this as the request handler.
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
