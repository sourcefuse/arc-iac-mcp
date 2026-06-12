import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
  const server = createServer();
  const anyServer = server as any;
  const body = req.body as any;

  const wantsSSE = (req.headers.accept || '').includes('text/event-stream');

  const send = (data: any, status = 200) => {
    if (wantsSSE) {
      res.status(status)
        .setHeader('Content-Type', 'text/event-stream')
        .setHeader('Cache-Control', 'no-cache')
        .write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
    } else {
      res.status(status).json(data);
    }
  };

  if (req.method === 'POST') {
    if (body?.method === 'initialize') {
      return send({
        jsonrpc: '2.0', id: body.id ?? 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'arc-iac', version: '1.0.0' },
        },
      });
    }

    if (body?.method === 'notifications/initialized') {
      return res.status(200).end();
    }

    if (body?.method === 'tools/list') {
      const tools = Object.entries(anyServer._registeredTools || {}).map(([name, t]: [string, any]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema?.schema || t.inputSchema || { type: 'object', properties: {} },
      }));
      return send({ jsonrpc: '2.0', id: body.id ?? 1, result: { tools } });
    }

    if (body?.method === 'tools/call') {
      const tool = anyServer._registeredTools?.[body.params?.name];
      if (!tool) {
        return send({ jsonrpc: '2.0', id: body.id ?? 1, error: { code: -32601, message: `Tool not found: ${body.params?.name}` } }, 404);
      }
      try {
        const result = await tool.handler(body.params?.arguments || {}, {});
        return send({ jsonrpc: '2.0', id: body.id ?? 1, result });
      } catch (err: any) {
        return send({ jsonrpc: '2.0', id: body.id ?? 1, error: { code: -32603, message: err.message } }, 500);
      }
    }

    if (body?.method === 'resources/list') {
      return send({ jsonrpc: '2.0', id: body.id ?? 1, result: { resources: [] } });
    }
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
