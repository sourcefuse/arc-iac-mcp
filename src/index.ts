import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

function createServer(): McpServer {
  const server = new McpServer({ name: 'arc-iac', version: '1.0.0' });
  registerTools(server);
  registerResources(server);
  return server;
}

const app = express();
app.use(cors());
app.use(express.json());

// Session store for stateful connections (persistent HTTP mode)
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

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Reuse existing session if available
  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session: must start with initialize
  if (!isInitializeRequest(req.body)) {
    res.status(400).json({ error: 'Must start session with initialize request' });
    return;
  }

  const newSessionId = randomUUID();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => newSessionId,
    onsessioninitialized: (id) => {
      sessions.set(id, { server, transport });
    },
  });

  const server = createServer();

  transport.onclose = () => {
    sessions.delete(newSessionId);
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// SSE stream endpoint for server-sent events (GET)
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session ID' });
    return;
  }
  const { transport } = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// Session cleanup
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!;
    await transport.handleRequest(req, res);
    sessions.delete(sessionId);
  } else {
    res.status(200).end();
  }
});

// Exported for Vercel
import serverless from 'serverless-http';
export const handler = serverless(app);
export default app;

const port = process.env.PORT ? parseInt(process.env.PORT) : undefined;

if (port && !process.env.VERCEL) {
  app.listen(port, () => {
    process.stderr.write(`arc-iac MCP server running on port ${port}\n`);
    process.stderr.write(`MCP endpoint: http://localhost:${port}/mcp\n`);
  });
} else if (!port && !process.env.VERCEL) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
