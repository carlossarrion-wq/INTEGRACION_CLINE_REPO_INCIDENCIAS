# Arquitectura Local MCP + Lambda Wrapper

## Descripción General

Esta es la arquitectura final implementada para integrar Cline con la base de conocimiento de incidencias en AWS Bedrock.

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cline (VS Code)                         │
│                                                                 │
│  - Ejecuta tareas de desarrollo                                │
│  - Necesita buscar incidencias similares                       │
└────────────────────────┬────────────────────────────────────────┘
                         │ stdio (local)
                         │ MCP Protocol
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Servidor MCP Local (Node.js)                       │
│              index-local.js                                     │
│                                                                 │
│  - Implementa protocolo MCP con stdio transport                │
│  - Expone herramienta: search_similar_incidents                │
│  - Usa credenciales AWS locales (~/.aws/credentials)           │
└────────────────────────┬────────────────────────────────────────┘
                         │ AWS SDK
                         │ Lambda.invoke()
                         │ IAM Authentication
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│           Lambda Function: mcp-incidents-kb-wrapper             │
│                      (AWS Lambda)                               │
│                                                                 │
│  - Recibe invocaciones directas (no HTTP)                      │
│  - Wrapper para acceso a Bedrock                               │
│  - Ejecuta búsquedas en Knowledge Base                         │
└────────────────────────┬────────────────────────────────────────┘
                         │ AWS Bedrock API
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Bedrock Knowledge Base (VH6SRH9ZNO)                │
│                                                                 │
│  - Vector search con embeddings                                │
│  - Base de datos: Aurora PostgreSQL + pgvector                 │
│  - Modelo: Amazon Titan v2                                     │
│  - Datos: S3 bucket con documentación de incidencias           │
└─────────────────────────────────────────────────────────────────┘
```

## Ventajas de Esta Arquitectura

### ✅ Simplicidad
- Un solo proceso Node.js local
- No requiere proxy adicional
- Configuración estándar de MCP

### ✅ Seguridad
- Credenciales AWS nunca salen de tu máquina
- Autenticación IAM robusta
- No expone endpoints HTTP públicos

### ✅ Rendimiento
- Conexión local rápida (stdio)
- Lambda solo para lógica de negocio
- Sin latencia de red innecesaria

### ✅ Escalabilidad
- Lambda puede ser reutilizada por otros clientes
- Fácil de extender con más herramientas
- Separación clara de responsabilidades

## Componentes

### 1. Servidor MCP Local (`src/index-local.ts`)

**Ubicación:** `/Users/csarrion/Cline/INTEGRACIÓN_CLINE_REPO_INCIDENCIAS/mcp-incidents-lambda/dist/index-local.js`

**Responsabilidades:**
- Implementar protocolo MCP con stdio transport
- Exponer herramienta `search_similar_incidents`
- Invocar Lambda usando AWS SDK
- Manejar errores y logging

**Variables de Entorno:**
- `AWS_REGION`: Región de AWS (default: eu-west-1)
- `LAMBDA_FUNCTION_NAME`: Nombre de la Lambda (default: mcp-incidents-kb-wrapper)

### 2. Lambda Wrapper (`src/index.ts`)

**Nombre:** `mcp-incidents-kb-wrapper`
**Runtime:** Node.js 20.x
**Memoria:** 1024 MB
**Timeout:** 300 segundos

**Responsabilidades:**
- Recibir invocaciones del servidor local
- Consultar Bedrock Knowledge Base
- Devolver resultados formateados

**Permisos IAM:**
- `bedrock:Retrieve` - Para consultar Knowledge Base
- `bedrock:RetrieveAndGenerate` - Para generación con KB
- `bedrock:InvokeModel` - Para invocar Claude (con wildcards multi-región)
- `s3:GetObject` - Para acceso al bucket de datos

**Nota importante sobre permisos:**
Los inference profiles de Bedrock enrutan automáticamente a múltiples regiones (eu-north-1, eu-west-1, eu-west-3, etc.). Por ello, los permisos deben incluir wildcards:
```yaml
Resource:
  - 'arn:aws:bedrock:*::foundation-model/*'
  - !Sub 'arn:aws:bedrock:*:${AWS::AccountId}:inference-profile/*'
```

### 3. Configuración Cline

**Archivo:** `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

```json
{
  "mcpServers": {
    "incidents-analyzer": {
      "command": "node",
      "args": [
        "/Users/csarrion/Cline/INTEGRACIÓN_CLINE_REPO_INCIDENCIAS/mcp-incidents-lambda/dist/index-local.js"
      ],
      "env": {
        "AWS_REGION": "eu-west-1",
        "LAMBDA_FUNCTION_NAME": "mcp-incidents-kb-wrapper"
      }
    }
  }
}
```

## Uso

### Desde Cline

Una vez configurado, puedes usar la herramienta desde Cline:

```typescript
// Cline automáticamente detecta la herramienta disponible
use_mcp_tool({
  server_name: "incidents-analyzer",
  tool_name: "search_similar_incidents",
  arguments: {
    query: "Error de conexión a base de datos PostgreSQL",
    maxResults: 5
  }
})
```

### Ejemplo de Respuesta

```json
{
  "results": [
    {
      "score": 0.89,
      "content": "Solución para error de conexión PostgreSQL...",
      "metadata": {
        "incident_id": "INC-12345",
        "date": "2024-09-15",
        "category": "Database"
      }
    }
  ]
}
```

## Requisitos Previos

### 1. AWS CLI Configurado

```bash
aws configure
# Introduce:
# - AWS Access Key ID
# - AWS Secret Access Key
# - Default region: eu-west-1
# - Default output format: json
```

Verifica la configuración:
```bash
aws sts get-caller-identity
```

### 2. Permisos IAM

Tu usuario AWS debe tener permiso para invocar la Lambda:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:eu-west-1:701055077130:function:mcp-incidents-kb-wrapper"
    }
  ]
}
```

### 3. Node.js 20.x

```bash
node --version  # Debe ser v20.x o superior
```

## Desarrollo

### Compilar Servidor Local

```bash
cd mcp-incidents-lambda
npm run build
```

Esto genera `dist/index-local.js` que es el servidor MCP.

### Probar Localmente

```bash
# Ejecutar servidor directamente
node dist/index-local.js

# El servidor esperará comandos MCP por stdin
```

### Ver Logs

Los logs del servidor local se escriben a `stderr`:

```bash
# Cline captura estos logs automáticamente
# También puedes verlos en la consola de Cline
```

Los logs de Lambda están en CloudWatch:

```bash
aws logs tail /aws/lambda/mcp-incidents-kb-wrapper --follow
```

## Troubleshooting

### Error: "Cannot find module '@modelcontextprotocol/sdk'"

```bash
cd mcp-incidents-lambda
npm install
npm run build
```

### Error: "AccessDeniedException" al invocar Lambda

Verifica tus credenciales AWS:

```bash
aws sts get-caller-identity
aws lambda get-function --function-name mcp-incidents-kb-wrapper
```

### Error: "Lambda function not found"

Verifica que la Lambda esté desplegada:

```bash
aws lambda list-functions --query "Functions[?FunctionName=='mcp-incidents-kb-wrapper']"
```

### Cline no detecta el servidor MCP

1. Verifica la configuración en `cline_mcp_settings.json`
2. Reinicia VS Code completamente
3. Verifica que la ruta al archivo `index-local.js` sea correcta

## Mantenimiento

### Actualizar Código

1. Modificar `src/index-local.ts` o `src/index.ts`
2. Compilar: `npm run build`
3. Si modificaste la Lambda, desplegar: `sam deploy --template-file infrastructure/template.yaml --stack-name mcp-incidents-server --capabilities CAPABILITY_IAM --resolve-s3`
4. Si modificaste el servidor local, reiniciar Cline

### Monitoreo

CloudWatch Alarms configuradas:
- **mcp-incidents-kb-wrapper-high-error-rate**: Alerta si hay >5 errores en 5 minutos
- **mcp-incidents-kb-wrapper-high-duration**: Alerta si la duración promedio >60 segundos

## Costos

### Lambda
- **Invocaciones:** $0.20 por 1M invocaciones
- **Duración:** $0.0000166667 por GB-segundo
- **Estimado:** ~$1-5/mes con uso moderado

### Bedrock
- **Knowledge Base queries:** $0.10 por 1000 queries
- **Embeddings:** Incluidos en Knowledge Base
- **Estimado:** ~$5-10/mes con uso moderado

### Total Estimado
**$6-15/mes** con uso moderado (100-500 queries/día)

## Próximos Pasos

1. ✅ Servidor MCP local implementado
2. ✅ Lambda wrapper desplegada
3. ✅ Configuración de Cline actualizada
4. ⏳ **Probar integración end-to-end**
5. ⏳ Añadir más herramientas (crear incidencia, actualizar, etc.)
6. ⏳ Implementar caché local para reducir costos
7. ⏳ Añadir métricas y dashboards

## Referencias

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [AWS Bedrock Knowledge Bases](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)
- [Cline Documentation](https://docs.cline.bot/)
