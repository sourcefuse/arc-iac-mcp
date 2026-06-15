import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listAllModules } from './registry.js';

export function registerResources(server: McpServer): void {
  server.resource(
    'arc-module-catalog',
    'arc://sourcefuse/modules',
    { mimeType: 'application/json', description: 'All SourceFuse ARC Terraform modules from registry.terraform.io' },
    async () => {
      const modules = await listAllModules();
      return {
        contents: [{
          uri: 'arc://sourcefuse/modules',
          mimeType: 'application/json',
          text: JSON.stringify(modules, null, 2),
        }],
      };
    }
  );
}
