# Guía de Testing - MCP Incidents Server

## 🎯 Estrategia de Testing Recomendada

**Orden recomendado:**
1. ✅ Tests unitarios (sin AWS)
2. ✅ Tests de integración local (con SAM Local)
3. ✅ Despliegue a AWS
4. ✅ Tests end-to-end en AWS

## 📋 Prerequisitos para Testing Local

```bash
# Instalar dependencias
cd mcp-incidents-lambda
npm install

# Instalar dependencias de desarrollo
npm install --save-dev jest @types/jest ts-jest

# Compilar TypeScript
npm run build
```

## 🧪 1. Tests Unitarios (Sin AWS)

### Configurar Jest

Crear `jest.config.js`:

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
```

### Tests de Tipos y Lógica

Crear `src/__tests__/mcp-server.test.ts`:

```typescript
import { MCPServer } from '../mcp-server';
import { MCPTool, MCPContext } from '../types/mcp';

// Mock tool para testing
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
    return { result: `Processed: ${args.input}` };
  }
}

describe('MCPServer', () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer({
      name: 'test-server',
      version: '1.0.0',
      tools: [new MockTool()]
    });
  });

  test('should initialize correctly', () => {
    expect(server).toBeDefined();
  });

  test('should handle initialize request', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: {}
    };

    const context: MCPContext = {
      userArn: 'arn:aws:iam::123456789012:user/test',
      userId: 'test-user',
      requestId: 'test-request-id'
    };

    const response = await server.handleRequest(request, context);

    expect(response.result).toBeDefined();
    expect(response.result.serverInfo.name).toBe('test-server');
  });

  test('should list tools', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'tools/list',
      params: {}
    };

    const context: MCPContext = {
      userArn: 'arn:aws:iam::123456789012:user/test',
      userId: 'test-user',
      requestId: 'test-request-id'
    };

    const response = await server.handleRequest(request, context);

    expect(response.result.tools).toHaveLength(1);
    expect(response.result.tools[0].name).toBe('mock_tool');
  });

  test('should call tool', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'tools/call',
      params: {
        name: 'mock_tool',
        arguments: { input: 'test' }
      }
    };

    const context: MCPContext = {
      userArn: 'arn:aws:iam::123456789012:user/test',
      userId: 'test-user',
      requestId: 'test-request-id'
    };

    const response = await server.handleRequest(request, context);

    expect(response.result.content).toBeDefined();
    expect(response.result.content[0].type).toBe('text');
  });

  test('should handle unknown method', async () => {
    const request = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'unknown_method',
      params: {}
    };

    const context: MCPContext = {
      userArn: 'arn:aws:iam::123456789012:user/test',
      userId: 'test-user',
      requestId: 'test-request-id'
    };

    const response = await server.handleRequest(request, context);

    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32601);
  });
});
```

### Ejecutar Tests Unitarios

```bash
# Ejecutar todos los tests
npm test

# Ejecutar con coverage
npm test -- --coverage

# Ejecutar en modo watch
npm test -- --watch

# Ejecutar un test específico
npm test -- mcp-server.test.ts
```

## 🔧 2. Testing Local con SAM Local

### Opción A: Invocar Lambda Localmente (Sin Bedrock)

Para probar sin conectar a AWS Bedrock, necesitas mockear los servicios:

Crear `src/__tests__/integration/lambda-local.test.ts`:

```typescript
import { handler } from '../../index';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';

describe('Lambda Handler - Local', () => {
  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:eu-west-1:123456789012:function:test',
    memoryLimitInMB: '1024',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test',
    logStreamName: 'test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {}
  };

  test('should reject unauthorized requests', async () => {
    const event: APIGatewayProxyEventV2 = {
      version: '2.0',
      routeKey: 'POST /',
      rawPath: '/',
      rawQueryString: '',
      headers: {},
      requestContext: {
        accountId: '123456789012',
        apiId: 'test-api',
        domainName: 'test.execute-api.eu-west-1.amazonaws.com',
        domainPrefix: 'test',
        http: {
          method: 'POST',
          path: '/',
          protocol: 'HTTP/1.1',
          sourceIp: '1.2.3.4',
          userAgent: 'test-agent'
        },
        requestId: 'test-request',
        routeKey: 'POST /',
        stage: 'test',
        time: '01/Jan/2025:00:00:00 +0000',
        timeEpoch: 1704067200000
      },
      isBase64Encoded: false
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(403);
  });

  test('should handle tools/list request', async () => {
    const event: APIGatewayProxyEventV2 = {
      version: '2.0',
      routeKey: 'POST /',
      rawPath: '/',
      rawQueryString: '',
      headers: {},
      requestContext: {
        accountId: '123456789012',
        apiId: 'test-api',
        domainName: 'test.execute-api.eu-west-1.amazonaws.com',
        domainPrefix: 'test',
        authorizer: {
          iam: {
            userArn: 'arn:aws:iam::123456789012:user/test',
            userId: 'AIDAI123456789',
            accountId: '123456789012'
          }
        },
        http: {
          method: 'POST',
          path: '/',
          protocol: 'HTTP/1.1',
          sourceIp: '1.2.3.4',
          userAgent: 'test-agent'
        },
        requestId: 'test-request',
        routeKey: 'POST /',
        stage: 'test',
        time: '01/Jan/2025:00:00:00 +0000',
        timeEpoch: 1704067200000
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      }),
      isBase64Encoded: false
    };

    const response = await handler(event, mockContext);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.result.tools).toBeDefined();
  });
});
```

### Opción B: SAM Local con Docker

```bash
# 1. Iniciar Lambda localmente
sam local start-lambda

# 2. En otra terminal, invocar con AWS CLI
aws lambda invoke \
  --function-name mcp-incidents-server \
  --endpoint-url http://localhost:3001 \
  --payload file://test-payloads/tools-list.json \
  response.json

cat response.json
```

Crear payloads de prueba en `test-payloads/`:

**test-payloads/tools-list.json**:
```json
{
  "body": "{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}",
  "requestContext": {
    "authorizer": {
      "iam": {
        "userArn": "arn:aws:iam::123456789012:user/test",
        "userId": "AIDAI123456789",
        "accountId": "123456789012"
      }
    },
    "http": {
      "method": "POST"
    }
  }
}
```

### Opción C: SAM Local API Gateway

```bash
# Iniciar API Gateway local
sam local start-api

# Probar con curl
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## 🌐 3. Testing con Bedrock (Requiere AWS)

Para probar con Bedrock real, necesitas credenciales AWS configuradas:

```bash
# Configurar credenciales
export AWS_PROFILE=default
export AWS_REGION=eu-west-1

# Variables de entorno para testing
export BEDROCK_KNOWLEDGE_BASE_ID=VH6SRH9ZNO
export BEDROCK_MODEL_ID=eu.anthropic.claude-sonnet-4-5-20250929-v1:0
export BEDROCK_REGION=eu-west-1
export LOG_LEVEL=DEBUG

# Ejecutar tests de integración
npm run test:integration
```

Crear `src/__tests__/integration/bedrock.test.ts`:

```typescript
import { BedrockKBService } from '../../services/bedrock-kb-service';
import { BedrockLLMService } from '../../services/bedrock-llm-service';

describe('Bedrock Integration Tests', () => {
  // Solo ejecutar si las credenciales están disponibles
  const skipIfNoCredentials = process.env.AWS_PROFILE ? test : test.skip;

  skipIfNoCredentials('should retrieve from Knowledge Base', async () => {
    const kbService = new BedrockKBService({
      knowledgeBaseId: process.env.BEDROCK_KNOWLEDGE_BASE_ID!,
      region: process.env.BEDROCK_REGION!
    });

    const result = await kbService.retrieve({
      query: 'servidor web no responde',
      maxResults: 3
    });

    expect(result.results).toBeDefined();
    expect(result.results.length).toBeGreaterThan(0);
  }, 30000); // 30 segundos timeout

  skipIfNoCredentials('should optimize query with LLM', async () => {
    const llmService = new BedrockLLMService({
      modelId: process.env.BEDROCK_MODEL_ID!,
      region: process.env.BEDROCK_REGION!
    });

    const optimized = await llmService.optimizeQuery(
      'el server no va bien y los usuarios se quejan'
    );

    expect(optimized).toBeDefined();
    expect(optimized.length).toBeGreaterThan(0);
  }, 30000);
});
```

## 📊 4. Testing End-to-End Después del Despliegue

Una vez desplegado en AWS:

```bash
# Obtener URL del servidor
FUNCTION_URL=$(aws cloudformation describe-stacks \
  --stack-name mcp-incidents-server \
  --query 'Stacks[0].Outputs[?OutputKey==`MCPServerUrl`].OutputValue' \
  --output text)

# Test 1: Listar herramientas
curl -X POST $FUNCTION_URL \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:eu-west-1:lambda" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq

# Test 2: Buscar incidencias (test completo)
curl -X POST $FUNCTION_URL \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:eu-west-1:lambda" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "id": 1,
    "params": {
      "name": "search_similar_incidents",
      "arguments": {
        "incident_description": "El servidor web no responde en el puerto 443",
        "optimize_query": true,
        "max_results": 3
      }
    }
  }' | jq

# Test 3: Verificar logs
aws logs tail /aws/lambda/mcp-incidents-server --follow
```

## 🎯 Estrategia Recomendada Paso a Paso

### Día 1: Tests Unitarios

```bash
# 1. Instalar dependencias
npm install

# 2. Añadir Jest
npm install --save-dev jest @types/jest ts-jest

# 3. Crear tests unitarios
# (crear archivos .test.ts)

# 4. Ejecutar tests
npm test

# 5. Verificar coverage
npm test -- --coverage
```

### Día 2: Tests Locales

```bash
# 1. Compilar
npm run build

# 2. Probar con SAM Local (sin Bedrock)
sam local start-api
# En otra terminal: curl tests

# 3. Probar con Bedrock (requiere AWS)
export AWS_PROFILE=default
npm run test:integration
```

### Día 3: Despliegue y Tests E2E

```bash
# 1. Desplegar
./infrastructure/deploy.sh

# 2. Tests E2E
# (ejecutar curls con --aws-sigv4)

# 3. Monitorear logs
aws logs tail /aws/lambda/mcp-incidents-server --follow

# 4. Probar desde Cline
# (configurar y usar desde VS Code)
```

## 🔍 Debugging

### Logs Locales

```bash
# Ver logs detallados
export LOG_LEVEL=DEBUG
npm run build
sam local start-api
```

### Logs en AWS

```bash
# Tiempo real
aws logs tail /aws/lambda/mcp-incidents-server --follow

# Buscar errores
aws logs filter-log-events \
  --log-group-name /aws/lambda/mcp-incidents-server \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '1 hour ago' +%s)000

# Ver invocaciones específicas
aws logs filter-log-events \
  --log-group-name /aws/lambda/mcp-incidents-server \
  --filter-pattern "[timestamp, request_id, level=INFO, msg=*Searching*]"
```

## ✅ Checklist de Testing

Antes de desplegar a producción:

- [ ] Tests unitarios pasan (npm test)
- [ ] Coverage > 80%
- [ ] Tests locales con SAM funcionan
- [ ] Tests de integración con Bedrock funcionan
- [ ] Despliegue exitoso en AWS
- [ ] Tests E2E con curl funcionan
- [ ] Logs se ven correctamente en CloudWatch
- [ ] Prueba desde Cline funciona
- [ ] Documentación actualizada

## 💡 Consejos

1. **Empieza simple**: Tests unitarios primero, sin AWS
2. **Mockea servicios**: Para tests rápidos sin costos
3. **Usa SAM Local**: Para probar Lambda sin desplegar
4. **Tests de integración**: Solo cuando necesites validar con Bedrock real
5. **Monitorea costos**: Los tests con Bedrock consumen tokens
6. **Automatiza**: Crea scripts para tests repetitivos

## 📝 Scripts Útiles para package.json

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:integration": "jest --testMatch='**/*.integration.test.ts'",
    "test:local": "sam local start-api",
    "test:e2e": "bash scripts/test-e2e.sh"
  }
}
