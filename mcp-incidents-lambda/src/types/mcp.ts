/**
 * Model Context Protocol (MCP) Types
 */

export interface MCPRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: any;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: any;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute(
    args: Record<string, any>,
    context: MCPContext
  ): Promise<any>;
}

export interface MCPContext {
  userArn: string;
  userId: string;
  requestId?: string;
}

export interface MCPServerConfig {
  name: string;
  version: string;
  tools: MCPTool[];
}

// SSE (Server-Sent Events) message format
export interface SSEMessage {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}
