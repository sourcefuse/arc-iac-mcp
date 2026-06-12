import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import serverless from 'serverless-http';

function createServer(): McpServer {
  const server = new McpServer({ name: 'arc-iac', version: '1.0.0' });
  registerTools(server);
  registerResources(server);
  return server;
}

// Creates a linked server+client pair using in-memory transport for one request
async function createBridge() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'bridge', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

const app = express();
app.use(cors());
app.use(express.json());

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

async function handleMcp(req: Request, res: Response) {
  const body = req.body as any;
  const wantsSSE = (req.headers.accept || '').includes('text/event-stream');

  const send = (data: any, status = 200) => {
    if (wantsSSE) {
      res.status(status)
        .setHeader('Content-Type', 'text/event-stream')
        .setHeader('Cache-Control', 'no-cache');
      res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
    } else {
      res.status(status).json(data);
    }
  };

  if (req.method !== 'POST') return res.status(200).end();

  const method = body?.method;

  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0', id: body.id ?? 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'arc-iac', version: '1.0.0' },
      },
    });
  }

  if (method === 'notifications/initialized') {
    return res.status(200).end();
  }

  // Route tools/list and tools/call through the real SDK pipeline
  try {
    const { client, server } = await createBridge();

    if (method === 'tools/list') {
      const result = await client.listTools();
      await server.close();
      return send({ jsonrpc: '2.0', id: body.id ?? 1, result });
    }

    if (method === 'tools/call') {
      const result = await client.callTool({
        name: body.params?.name,
        arguments: body.params?.arguments ?? {},
      });
      await server.close();
      return send({ jsonrpc: '2.0', id: body.id ?? 1, result });
    }

    if (method === 'resources/list') {
      await server.close();
      return send({ jsonrpc: '2.0', id: body.id ?? 1, result: { resources: [] } });
    }

    await server.close();
  } catch (err: any) {
    return send({ jsonrpc: '2.0', id: body?.id ?? 1, error: { code: -32603, message: err.message } }, 500);
  }

  return res.status(200).end();
}

app.all('/mcp', handleMcp);

export const handler = serverless(app);
export default app;

const port = process.env.PORT ? parseInt(process.env.PORT) : undefined;

if (port && !process.env.VERCEL) {
  app.listen(port, () => {
    process.stderr.write(`arc-iac MCP server running on port ${port}\n`);
  });
} else if (!port && !process.env.VERCEL) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
