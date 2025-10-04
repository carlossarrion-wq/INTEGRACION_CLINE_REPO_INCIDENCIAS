/**
 * Plan de Pruebas Unitarias - MCP Server
 * 10 tests esenciales para validar funcionalidad básica
 */

import { MCPServer } from '../mcp-server';
import { MCPTool, MCPContext } from '../types/mcp';

// Mock tool simple para testing
class MockTool implements MCPTool {
  name = 'mock_tool';
  description = 'A mock tool for testing';
  inputSchema = {
    type: 'object' as const,
    properties: {
      input: { type: 'string' }
    },
    required: ['input']
  };

  async execute(args: any, context: MCPContext): Promise<any> {
    return { result: `Processed: ${args.input}`, userId: context.userId };
  }
}

describe('MCP Server - Plan de Pruebas Unitarias (10 tests)', () => {
  let server: MCPServer;
  const mockContext: MCPContext = {
    userArn: 'arn:aws:iam::123456789012:user/test-user',
    userId: 'test-user-id',
    requestId: 'test-request-123'
  };

  beforeEach(() => {
    server = new MCPServer({
      name: 'test-server',
      version: '1.0.0',
      tools: [new MockTool()]
    });
  });

  // TEST 1: Inicialización del servidor
  test('1. Debe inicializar el servidor correctamente', () => {
    expect(server).toBeDefined();
    expect(server).toBeInstanceOf(MCPServer);
  });

  // TEST 2: Respuesta a solicitud de inicialización
  test('2. Debe responder a solicitud de initialize con información del servidor', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: {}
    };

    const response = await server.handleRequest(request, mockContext);

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.result).toBeDefined();
    expect(response.result.serverInfo.name).toBe('test-server');
    expect(response.result.serverInfo.version).toBe('1.0.0');
    expect(response.result.protocolVersion).toBeDefined();
  });

  // TEST 3: Listar herramientas disponibles
  test('3. Debe listar todas las herramientas disponibles', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 2,
      method: 'tools/list',
      params: {}
    };

    const response = await server.handleRequest(request, mockContext);

    expect(response.result.tools).toBeDefined();
    expect(response.result.tools).toHaveLength(1);
    expect(response.result.tools[0].name).toBe('mock_tool');
    expect(response.result.tools[0].description).toBeDefined();
    expect(response.result.tools[0].inputSchema).toBeDefined();
  });

  // TEST 4: Ejecutar herramienta con parámetros válidos
  test('4. Debe ejecutar herramienta con parámetros válidos', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 3,
      method: 'tools/call',
      params: {
        name: 'mock_tool',
        arguments: { input: 'test-data' }
      }
    };

    const response = await server.handleRequest(request, mockContext);

    expect(response.result).toBeDefined();
    expect(response.result.content).toBeDefined();
    expect(response.result.content[0].type).toBe('text');
    expect(response.result.content[0].text).toContain('test-data');
  });

  // TEST 5: Error al llamar herramienta inexistente
  test('5. Debe retornar error al llamar herramienta inexistente', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 4,
      method: 'tools/call',
      params: {
        name: 'non_existent_tool',
        arguments: {}
      }
    };

    const response = await server.handleRequest(request, mockContext);

    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toContain('not found');
  });

  // TEST 6: Error con método desconocido
  test('6. Debe retornar error con método desconocido', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 5,
      method: 'unknown_method',
      params: {}
    };

    const response = await server.handleRequest(request, mockContext);

    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32601);
    expect(response.error?.message).toContain('Method not found');
  });

  // TEST 7: Validar formato de respuesta JSON-RPC
  test('7. Debe mantener formato JSON-RPC 2.0 en todas las respuestas', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 6,
      method: 'tools/list',
      params: {}
    };

    const response = await server.handleRequest(request, mockContext);

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(6);
    expect(response).toHaveProperty('result');
  });

  // TEST 8: Contexto de usuario se pasa correctamente
  test('8. Debe pasar contexto de usuario a la herramienta', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 7,
      method: 'tools/call',
      params: {
        name: 'mock_tool',
        arguments: { input: 'context-test' }
      }
    };

    const response = await server.handleRequest(request, mockContext);

    const resultText = response.result.content[0].text;
    const parsedResult = JSON.parse(resultText);
    
    expect(parsedResult.userId).toBe('test-user-id');
  });

  // TEST 9: Error al llamar herramienta sin parámetros requeridos
  test('9. Debe manejar llamada a herramienta sin nombre', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 8,
      method: 'tools/call',
      params: {
        arguments: { input: 'test' }
      }
    };

    const response = await server.handleRequest(request, mockContext);

    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32602);
  });

  // TEST 10: Formato SSE para streaming
  test('10. Debe formatear respuestas para SSE correctamente', () => {
    const testData = { message: 'test', value: 123 };
    const sseFormatted = server.formatSSEResponse(testData);

    expect(sseFormatted).toContain('data: ');
    expect(sseFormatted).toContain(JSON.stringify(testData));
    expect(sseFormatted).toMatch(/\n\n$/);
  });
});
