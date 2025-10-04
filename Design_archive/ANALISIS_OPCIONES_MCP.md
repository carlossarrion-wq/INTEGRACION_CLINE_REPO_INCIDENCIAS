# ANÁLISIS DE OPCIONES PARA SERVIDOR MCP

## CONTEXTO

Necesitamos decidir entre dos arquitecturas para proporcionar las funcionalidades MCP que permitirán a Cline interactuar con el sistema de análisis de incidencias en AWS:

1. **MCP Local + Lambda vía API Gateway**
2. **Lambda como MCP Remoto**

---

## OPCIÓN 1: MCP LOCAL + LAMBDA VÍA API GATEWAY

### Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code (Cline)                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │              Cline Agent                            │ │
│  └──────────────────────┬─────────────────────────────┘ │
└─────────────────────────┼───────────────────────────────┘
                          │ MCP Protocol (stdio/SSE)
                          ▼
┌─────────────────────────────────────────────────────────┐
│              MCP Server (Local Node.js)                  │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Tools:                                             │ │
│  │  - search_incidents()                               │ │
│  │  - get_incident_details()                           │ │
│  │  - download_context()                               │ │
│  │  - report_resolution()                              │ │
│  │  - find_patterns()                                  │ │
│  └──────────────────────┬─────────────────────────────┘ │
└─────────────────────────┼───────────────────────────────┘
                          │ HTTPS/REST
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    AWS API Gateway                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Endpoints:                                         │ │
│  │  POST /incidents/search                             │ │
│  │  GET  /incidents/{id}                               │ │
│  │  POST /incidents/context/download                   │ │
│  │  POST /incidents/resolution                         │ │
│  │  POST /incidents/patterns                           │ │
│  └──────────────────────┬─────────────────────────────┘ │
└─────────────────────────┼───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   Lambda Functions                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ search-      │  │ get-details  │  │ download-    │  │
│  │ incidents    │  │              │  │ context      │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────┼───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              AWS Data Layer                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │DynamoDB  │  │ Aurora   │  │   S3     │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────────────────────────────────────┘
```

### Ventajas ✅

1. **Control Total del MCP Server**
   - Implementación completa del protocolo MCP
   - Flexibilidad para agregar funcionalidades
   - Debugging más sencillo en desarrollo

2. **Separación de Responsabilidades**
   - MCP Server: Manejo del protocolo y comunicación con Cline
   - Lambda: Lógica de negocio y acceso a datos
   - Cada componente tiene un propósito claro

3. **Reutilización de Lambda**
   - Las mismas Lambdas pueden ser usadas por otros clientes
   - API Gateway puede servir a múltiples consumidores
   - Facilita integración con otros sistemas

4. **Desarrollo Independiente**
   - Equipo puede trabajar en Lambda sin afectar MCP
   - Despliegue independiente de cada componente
   - Testing más granular

5. **Caché Local**
   - Posibilidad de cachear respuestas en el MCP local
   - Reduce latencia en consultas repetidas
   - Menor costo de llamadas a AWS

6. **Manejo de Ficheros Local**
   - `download_context` puede escribir directamente en disco
   - No necesita transferir archivos grandes por red
   - Mejor experiencia para el desarrollador

### Desventajas ⚠️

1. **Complejidad de Configuración**
   - Usuario debe instalar y configurar MCP Server local
   - Requiere Node.js en la máquina del desarrollador
   - Configuración de credenciales AWS

2. **Mantenimiento Distribuido**
   - Dos componentes que mantener (MCP + Lambda)
   - Actualizaciones requieren coordinación
   - Versionado más complejo

3. **Dependencia de Entorno Local**
   - Requiere recursos de la máquina del desarrollador
   - Puede haber problemas de compatibilidad (OS, Node version)
   - Debugging más complejo en producción

4. **Seguridad**
   - Credenciales AWS en máquina local
   - Necesidad de gestión de secretos
   - Posible exposición de API keys

### Implementación

**Estructura del Proyecto:**
```
mcp-incident-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # MCP Server setup
│   ├── tools/
│   │   ├── search-incidents.ts
│   │   ├── get-incident-details.ts
│   │   ├── download-context.ts
│   │   ├── report-resolution.ts
│   │   └── find-patterns.ts
│   ├── services/
│   │   ├── api-client.ts     # Cliente para API Gateway
│   │   ├── file-manager.ts   # Gestión de ficheros locales
│   │   └── cache-manager.ts  # Caché local
│   └── utils/
│       ├── logger.ts
│       └── config.ts
└── README.md
```

**Configuración (cline_mcp_settings.json):**
```json
{
  "mcpServers": {
    "incident-analyzer": {
      "command": "node",
      "args": ["/path/to/mcp-incident-server/dist/index.js"],
      "env": {
        "AWS_REGION": "eu-west-1",
        "API_GATEWAY_URL": "https://api.example.com",
        "API_KEY": "${AWS_API_KEY}",
        "CACHE_ENABLED": "true",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

---

## OPCIÓN 2: LAMBDA COMO MCP REMOTO

### Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code (Cline)                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │              Cline Agent                            │ │
│  └──────────────────────┬─────────────────────────────┘ │
└─────────────────────────┼───────────────────────────────┘
                          │ MCP over HTTP (SSE)
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    AWS API Gateway                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │  MCP Endpoint:                                      │ │
│  │  POST /mcp/messages                                 │ │
│  │  GET  /mcp/sse (Server-Sent Events)                │ │
│  └──────────────────────┬─────────────────────────────┘ │
└─────────────────────────┼───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│            Lambda MCP Server (Python/Node.js)            │
│  ┌────────────────────────────────────────────────────┐ │
│  │  MCP Protocol Handler                               │ │
│  │  ├── Tool Execution                                 │ │
│  │  ├── Resource Access                                │ │
│  │  └── Prompt Management                              │ │
│  │                                                      │ │
│  │  Business Logic:                                    │ │
│  │  - search_incidents()                               │ │
│  │  - get_incident_details()                           │ │
│  │  - download_context()                               │ │
│  │  - report_resolution()                              │ │
│  │  - find_patterns()                                  │ │
│  └──────────────────────┬─────────────────────────────┘ │
└─────────────────────────┼───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              AWS Data Layer                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │DynamoDB  │  │ Aurora   │  │   S3     │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────────────────────────────────────┘
```

### Ventajas ✅

1. **Simplicidad de Configuración**
   - Usuario solo necesita URL y API key
   - No requiere instalación local
   - Configuración mínima en Cline

2. **Mantenimiento Centralizado**
   - Un solo componente que mantener
   - Actualizaciones transparentes para usuarios
   - Versionado simplificado

3. **Escalabilidad Automática**
   - Lambda escala automáticamente
   - No consume recursos locales
   - Mejor para equipos grandes

4. **Seguridad Mejorada**
   - Credenciales AWS solo en Lambda
   - No hay secretos en máquinas locales
   - Control centralizado de acceso

5. **Consistencia**
   - Todos los usuarios usan la misma versión
   - Comportamiento predecible
   - Más fácil dar soporte

6. **Monitorización Centralizada**
   - CloudWatch logs para todas las operaciones
   - Métricas agregadas
   - Debugging más sencillo en producción

### Desventajas ⚠️

1. **Latencia de Red**
   - Cada operación requiere llamada HTTP
   - Mayor latencia que ejecución local
   - Dependencia de conectividad

2. **Limitaciones de Lambda**
   - Timeout máximo: 15 minutos
   - Payload máximo: 6 MB (síncrono)
   - Cold starts pueden afectar performance

3. **Manejo de Ficheros Complejo**
   - `download_context` debe transferir archivos por red
   - Necesita mecanismo para enviar archivos grandes
   - Posible uso de S3 presigned URLs

4. **Costos**
   - Cada llamada a Lambda tiene costo
   - Transferencia de datos
   - API Gateway requests

5. **Debugging Local Difícil**
   - No se puede ejecutar localmente fácilmente
   - Requiere SAM o similar para testing local
   - Ciclo de desarrollo más lento

6. **Dependencia de AWS**
   - Requiere conectividad constante
   - No funciona offline
   - Vendor lock-in más fuerte

### Implementación

**Estructura del Proyecto:**
```
lambda-mcp-server/
├── package.json / requirements.txt
├── src/
│   ├── handler.ts/py         # Lambda handler
│   ├── mcp/
│   │   ├── protocol.ts       # MCP protocol implementation
│   │   ├── tools.ts          # Tool definitions
│   │   └── resources.ts      # Resource definitions
│   ├── services/
│   │   ├── dynamodb.ts
│   │   ├── aurora.ts
│   │   ├── s3.ts
│   │   └── embeddings.ts
│   └── utils/
│       └── logger.ts
├── template.yaml             # SAM template
└── README.md
```

**Configuración (cline_mcp_settings.json):**
```json
{
  "mcpServers": {
    "incident-analyzer": {
      "url": "https://mcp.example.com",
      "apiKey": "${MCP_API_KEY}",
      "transport": "sse"
    }
  }
}
```

### Autenticación en MCP Remoto

**SÍ, el protocolo MCP remoto soporta autenticación robusta.** Existen varios mecanismos:

#### 1. **API Key Authentication** (Más Simple)

```json
{
  "mcpServers": {
    "incident-analyzer": {
      "url": "https://mcp.example.com",
      "apiKey": "sk_live_abc123...",
      "transport": "sse"
    }
  }
}
```

**Implementación en Lambda:**
```typescript
// Lambda handler
export const handler = async (event: APIGatewayProxyEvent) => {
  // Validar API Key
  const apiKey = event.headers['Authorization']?.replace('Bearer ', '');
  
  if (!apiKey || !await validateApiKey(apiKey)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }
  
  // Verificar permisos del usuario
  const user = await getUserFromApiKey(apiKey);
  if (!user.hasPermission('incidents:read')) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Forbidden' })
    };
  }
  
  // Procesar request MCP
  return handleMCPRequest(event, user);
};
```

#### 2. **OAuth 2.0 / JWT** (Más Seguro)

```json
{
  "mcpServers": {
    "incident-analyzer": {
      "url": "https://mcp.example.com",
      "auth": {
        "type": "oauth2",
        "tokenUrl": "https://auth.example.com/token",
        "clientId": "mcp-client-id",
        "clientSecret": "${OAUTH_CLIENT_SECRET}",
        "scopes": ["incidents:read", "incidents:write"]
      },
      "transport": "sse"
    }
  }
}
```

**Flujo OAuth:**
```
1. Cliente solicita token → Auth Server
2. Auth Server valida credenciales → Retorna JWT
3. Cliente incluye JWT en cada request MCP
4. Lambda valida JWT y permisos
```

#### 3. **AWS IAM Authentication** (Para Entornos AWS)

```json
{
  "mcpServers": {
    "incident-analyzer": {
      "url": "https://mcp.example.com",
      "auth": {
        "type": "aws-iam",
        "region": "eu-west-1",
        "service": "execute-api"
      },
      "transport": "sse"
    }
  }
}
```

**Ventajas:**
- Usa credenciales AWS del usuario
- No necesita gestionar API keys adicionales
- Integración nativa con IAM policies

#### 4. **mTLS (Mutual TLS)** (Máxima Seguridad)

```json
{
  "mcpServers": {
    "incident-analyzer": {
      "url": "https://mcp.example.com",
      "auth": {
        "type": "mtls",
        "clientCert": "/path/to/client-cert.pem",
        "clientKey": "/path/to/client-key.pem",
        "caCert": "/path/to/ca-cert.pem"
      },
      "transport": "sse"
    }
  }
}
```

### Control de Acceso Granular

**Permisos por Tool:**
```typescript
// Definir permisos requeridos por tool
const toolPermissions = {
  'search_incidents': ['incidents:read'],
  'get_incident_details': ['incidents:read'],
  'download_context': ['incidents:read', 'incidents:download'],
  'report_resolution': ['incidents:write'],
  'find_patterns': ['incidents:read', 'incidents:analyze']
};

// Validar en cada tool execution
async function executeTool(toolName: string, user: User, params: any) {
  const requiredPermissions = toolPermissions[toolName];
  
  if (!user.hasAllPermissions(requiredPermissions)) {
    throw new Error(`Insufficient permissions for ${toolName}`);
  }
  
  return await tools[toolName](params);
}
```

### Auditoría y Logging

```typescript
// Registrar cada operación
await auditLog.create({
  userId: user.id,
  action: 'mcp.tool.execute',
  tool: toolName,
  params: sanitizeParams(params),
  timestamp: new Date(),
  ipAddress: event.requestContext.identity.sourceIp,
  userAgent: event.headers['User-Agent']
});
```

### Rate Limiting por Usuario

```typescript
// Limitar requests por usuario
const rateLimiter = new RateLimiter({
  windowMs: 60000, // 1 minuto
  maxRequests: 100  // 100 requests por minuto
});

if (!await rateLimiter.checkLimit(user.id)) {
  return {
    statusCode: 429,
    body: JSON.stringify({ error: 'Rate limit exceeded' })
  };
}
```

### Gestión de API Keys

**Tabla DynamoDB para API Keys:**
```typescript
{
  apiKey: 'sk_live_abc123...',
  userId: 'user-123',
  name: 'Development Key',
  permissions: ['incidents:read', 'incidents:write'],
  createdAt: '2025-01-03T10:00:00Z',
  expiresAt: '2025-07-03T10:00:00Z',
  lastUsedAt: '2025-01-03T15:30:00Z',
  rateLimit: 1000, // requests por hora
  ipWhitelist: ['192.168.1.0/24']
}
```

### Comparación de Métodos de Autenticación

| Método | Seguridad | Complejidad | Uso Recomendado |
|--------|-----------|-------------|-----------------|
| **API Key** | ⭐⭐⭐ | Baja | Desarrollo, APIs internas |
| **OAuth 2.0** | ⭐⭐⭐⭐ | Media | Producción, múltiples usuarios |
| **AWS IAM** | ⭐⭐⭐⭐⭐ | Media | Entornos AWS, equipos internos |
| **mTLS** | ⭐⭐⭐⭐⭐ | Alta | Alta seguridad, B2B |

### Recomendación de Seguridad

Para el caso de uso de incidencias, recomiendo:

1. **Fase 1 (MVP)**: API Key con permisos básicos
2. **Fase 2 (Producción)**: OAuth 2.0 + JWT con permisos granulares
3. **Fase 3 (Enterprise)**: AWS IAM + mTLS para máxima seguridad

**Implementación Sugerida:**
```typescript
// Soportar múltiples métodos de autenticación
const authStrategies = {
  'api-key': new ApiKeyStrategy(),
  'oauth2': new OAuth2Strategy(),
  'aws-iam': new AWSIAMStrategy(),
  'mtls': new MTLSStrategy()
};

export const handler = async (event: APIGatewayProxyEvent) => {
  // Detectar método de autenticación
  const authType = detectAuthType(event);
  const strategy = authStrategies[authType];
  
  // Autenticar
  const user = await strategy.authenticate(event);
  
  if (!user) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  
  // Procesar request
  return handleMCPRequest(event, user);
};
```

---

## COMPARACIÓN DETALLADA

| Criterio | MCP Local + Lambda | Lambda MCP Remoto |
|----------|-------------------|-------------------|
| **Complejidad Setup** | ⚠️ Media-Alta | ✅ Baja |
| **Mantenimiento** | ⚠️ Distribuido | ✅ Centralizado |
| **Performance** | ✅ Mejor (local) | ⚠️ Latencia red |
| **Escalabilidad** | ⚠️ Por máquina | ✅ Auto-scaling |
| **Seguridad** | ⚠️ Credenciales locales | ✅ Centralizada |
| **Costos** | ✅ Menores | ⚠️ Por uso |
| **Debugging** | ✅ Más fácil local | ⚠️ Más complejo |
| **Offline** | ✅ Posible con caché | ❌ No funciona |
| **Manejo Ficheros** | ✅ Directo a disco | ⚠️ Vía red/S3 |
| **Actualizaciones** | ⚠️ Manual | ✅ Automáticas |
| **Consistencia** | ⚠️ Versiones diferentes | ✅ Única versión |
| **Flexibilidad** | ✅ Alta | ⚠️ Media |

---

## RECOMENDACIÓN: OPCIÓN 1 (MCP LOCAL + LAMBDA)

### Justificación

Recomiendo la **Opción 1: MCP Local + Lambda vía API Gateway** por las siguientes razones:

#### 1. **Mejor Experiencia de Desarrollo**
- El desarrollador trabaja con ficheros locales directamente
- `download_context` escribe en `.cline/incidents/` sin latencia
- Debugging más sencillo durante desarrollo del MCP

#### 2. **Arquitectura Más Limpia**
- Separación clara de responsabilidades
- MCP Server se enfoca en el protocolo
- Lambda se enfoca en lógica de negocio
- Facilita testing unitario de cada componente

#### 3. **Reutilización de Infraestructura**
- Las Lambdas pueden servir a otros clientes (web app, CLI, etc.)
- API Gateway es un punto de entrada estándar
- No estás atado al protocolo MCP para todo

#### 4. **Flexibilidad Futura**
- Fácil agregar caché local
- Posibilidad de modo offline
- Extensible con plugins locales

#### 5. **Performance**
- Operaciones locales son instantáneas
- Caché reduce llamadas a AWS
- Mejor para operaciones frecuentes

#### 6. **Madurez del Ecosistema**
- MCP SDK para Node.js está bien documentado
- Muchos ejemplos de MCP servers locales
- Comunidad activa

### Mitigación de Desventajas

**Complejidad de Setup:**
- Crear script de instalación automatizado
- Documentación clara paso a paso
- Proveer Docker image como alternativa

**Mantenimiento:**
- Versionado semántico claro
- Auto-update opcional
- Notificaciones de nuevas versiones

**Seguridad:**
- Usar AWS SSO/IAM roles cuando sea posible
- Secrets en keychain del sistema
- Documentar mejores prácticas

---

## PLAN DE IMPLEMENTACIÓN RECOMENDADO

### Fase 1: MVP (2-3 semanas)

**Semana 1: Infraestructura AWS**
- [ ] Crear Lambdas básicas (search, get_details)
- [ ] Configurar API Gateway
- [ ] Setup DynamoDB y Aurora
- [ ] Implementar autenticación (API Key)

**Semana 2: MCP Server Local**
- [ ] Setup proyecto Node.js con MCP SDK
- [ ] Implementar tools básicos
- [ ] Cliente para API Gateway
- [ ] Gestión de ficheros locales

**Semana 3: Testing e Integración**
- [ ] Tests unitarios
- [ ] Tests de integración
- [ ] Documentación
- [ ] Script de instalación

### Fase 2: Funcionalidades Avanzadas (2-3 semanas)

- [ ] Implementar `download_context` completo
- [ ] Implementar `report_resolution`
- [ ] Implementar `find_patterns`
- [ ] Caché local
- [ ] Manejo de errores robusto

### Fase 3: Optimización (1-2 semanas)

- [ ] Performance tuning
- [ ] Monitorización
- [ ] Auto-update
- [ ] Documentación avanzada

---

## ALTERNATIVA: ENFOQUE HÍBRIDO

Si la complejidad de setup es una preocupación, considera un **enfoque híbrido**:

1. **Empezar con Lambda MCP Remoto** (más rápido de implementar)
2. **Migrar a MCP Local** cuando el sistema madure
3. **Ofrecer ambas opciones** al usuario

Esto permite:
- Validar el concepto rápidamente
- Obtener feedback temprano
- Evolucionar la arquitectura basándose en uso real

---

## CONCLUSIÓN

**Recomendación Final: Opción 1 (MCP Local + Lambda vía API Gateway)**

Esta arquitectura ofrece el mejor balance entre:
- ✅ Experiencia de usuario
- ✅ Flexibilidad técnica
- ✅ Mantenibilidad a largo plazo
- ✅ Performance

Aunque requiere más esfuerzo inicial de setup, los beneficios a largo plazo justifican la inversión, especialmente para un sistema que será usado intensivamente por desarrolladores.

---

**Próximos Pasos Sugeridos:**

1. Validar esta recomendación con el equipo
2. Crear PoC del MCP Server local
3. Implementar 1-2 tools básicos
4. Probar integración con Cline
5. Iterar basándose en feedback
