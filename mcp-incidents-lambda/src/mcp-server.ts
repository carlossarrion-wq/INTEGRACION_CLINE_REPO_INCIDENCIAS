/**
 * MCP Server Implementation
 * Handles MCP protocol requests and tool execution
 */

import {
  MCPTool,
  MCPRequest,
  MCPResponse,
  MCPContext,
  MCPServerConfig,
  MCPError,
} from './types/mcp';
import { logger } from './utils/logger';

export class MCPServer {
  private tools: Map<string, MCPTool>;
  private name: string;
  private version: string;

  constructor(config: MCPServerConfig) {
    this.name = config.name;
    this.version = config.version;
    this.tools = new Map(config.tools.map((tool) => [tool.name, tool]));

    logger.info(`MCP Server initialized: ${this.name} v${this.version}`);
    logger.info(`Registered tools: ${Array.from(this.tools.keys()).join(', ')}`);
  }

  async handleRequest(request: MCPRequest, context: MCPContext): Promise<MCPResponse> {
    logger.info(`Handling MCP request: ${request.method}`, { requestId: context.requestId });

    try {
      let result: any;

      switch (request.method) {
        case 'initialize':
          result = this.handleInitialize();
          break;

        case 'tools/list':
          result = this.handleToolsList();
          break;

        case 'tools/call':
          result = await this.handleToolCall(request.params, context);
          break;

        default:
          throw this.createError(-32601, `Method not found: ${request.method}`);
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error) {
      logger.error('Error handling MCP request', error);

      // Si el error ya es un MCPError (tiene code y message), usarlo directamente
      const mcpError: MCPError =
        error && typeof error === 'object' && 'code' in error && 'message' in error
          ? (error as MCPError)
          : this.createError(-32603, error instanceof Error ? error.message : String(error));

      return {
        jsonrpc: '2.0',
        id: request.id,
        error: mcpError,
      };
    }
  }

  private handleInitialize(): any {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: this.name,
        version: this.version,
      },
    };
  }

  private handleToolsList(): any {
    const toolsList = Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    return {
      tools: toolsList,
    };
  }

  private async handleToolCall(params: any, context: MCPContext): Promise<any> {
    if (!params || !params.name) {
      throw this.createError(-32602, 'Invalid params: name is required');
    }

    const { name, arguments: args } = params;

    const tool = this.tools.get(name);
    if (!tool) {
      throw this.createError(-32602, `Tool not found: ${name}`);
    }

    logger.info(`Executing tool: ${name}`, { userId: context.userId });

    try {
      const result = await tool.execute(args || {}, context);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error(`Tool execution failed: ${name}`, error);
      throw this.createError(
        -32000,
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private createError(code: number, message: string, data?: any): MCPError {
    return {
      code,
      message,
      ...(data && { data }),
    };
  }

  formatSSEResponse(data: any): string {
    return `data: ${JSON.stringify(data)}\n\n`;
  }
}
