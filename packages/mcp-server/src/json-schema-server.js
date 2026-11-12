import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

export class JsonSchemaMcpServer extends Server {
  constructor(info) {
    super(info, { capabilities: { tools: { listChanged: true } } });
    this.tools = new Map();
    this.validator = new AjvJsonSchemaValidator();
    this.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...this.tools.values()].map(({ declaration }) => declaration),
    }));
    this.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        const tool = this.tools.get(request.params.name);
        if (!tool) throw new Error(`Unknown tool '${request.params.name}'`);
        const input = tool.validateInput(request.params.arguments ?? {});
        if (!input.valid) throw new Error(`Invalid arguments for tool '${request.params.name}': ${input.errorMessage}`);
        const result = await tool.handler(input.data, extra);
        if (tool.validateOutput && !result.isError) {
          if (result.structuredContent === undefined) {
            throw new Error(`Tool '${request.params.name}' requires structured content`);
          }
          const output = tool.validateOutput(result.structuredContent);
          if (!output.valid) throw new Error(`Invalid output for tool '${request.params.name}': ${output.errorMessage}`);
        }
        return result;
      } catch (error) {
        if (error instanceof McpError && error.code === ErrorCode.UrlElicitationRequired) throw error;
        return { isError: true, content: [{ type: 'text', text: String(error?.message ?? error) }] };
      }
    });
  }

  registerTool(name, config, handler) {
    if (this.tools.has(name)) throw new Error(`Duplicate tool '${name}'`);
    const declaration = {
      name,
      ...config,
      inputSchema: config.inputSchema ?? { type: 'object', properties: {} },
    };
    const tool = {
      declaration,
      handler,
      validateInput: this.validator.getValidator(declaration.inputSchema),
      validateOutput: declaration.outputSchema
        ? this.validator.getValidator(declaration.outputSchema)
        : undefined,
    };
    this.tools.set(name, tool);
    this.notifyToolListChanged();
    return {
      remove: () => {
        if (this.tools.get(name) === tool) {
          this.tools.delete(name);
          this.notifyToolListChanged();
        }
      },
    };
  }

  notifyToolListChanged() {
    if (this.transport) {
      void this.sendToolListChanged().catch((error) => {
        if (this.onerror) this.onerror(error);
        else process.stderr.write(`[mcp-server] Tool-list notification failed: ${String(error?.message ?? error)}\n`);
      });
    }
  }
}
