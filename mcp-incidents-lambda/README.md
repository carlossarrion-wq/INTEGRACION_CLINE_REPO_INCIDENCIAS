# MCP Incidents Server - Servidor Local con Lambda Wrapper

Servidor MCP (Model Context Protocol) local que permite a Cline buscar y analizar incidencias similares desde una base de conocimiento en AWS Bedrock.

## 🎯 Arquitectura

```
Cline (VS Code)
    ↓ stdio transport
Servidor MCP Local (Node.js)
    ↓ AWS SDK (Lambda.invoke)
Lambda Wrapper (eu-west-1)
    ↓ Bedrock Agent Runtime
Knowledge Base (Aurora PostgreSQL + pgvector)
    ↓ Bedrock Runtime
Claude Sonnet 4.5 (inference profile multi-región)
```

## ✨ Características

- ✅ **Servidor MCP Local** con stdio transport
- ✅ **Lambda Wrapper** para acceso a Bedrock
- ✅ **Autenticación AWS IAM** con credenciales locales
- ✅ **Búsqueda Vectorial** en Aurora PostgreSQL + pgvector
- ✅ **Análisis con Claude Sonnet 4.5** para diagnóstico y recomendaciones
- ✅ **Optimización de Consultas** con IA
- ✅ **Búsqueda Híbrida** (semántica + keywords)
- ✅ **Sin Servidores Locales** - Solo un proceso Node.js
- ✅ **Económico** - ~$6-15/mes con uso moderado

## 📋 Prerequisitos

### Software Requerido

```bash
# Node.js 20+
node --version  # v20.x.x

# npm
npm --version   # 10.x.x

# AWS CLI configurado
aws --version   # aws-cli/2.x.x
aws sts get-caller-identity  # Debe mostrar tu identidad AWS

# AWS SAM CLI (solo para despliegue)
sam --version   # SAM CLI, version 1.x.x
```

### Credenciales AWS

```bash
# Configurar credenciales
aws configure
# Introduce:
# - AWS Access Key ID
# - AWS Secret Access Key  
# - Default region: eu-west-1
# - Default output format: json

# Verificar
aws sts get-caller-identity
```

### Permisos AWS Requeridos

Tu usuario AWS necesita:
- `lambda:InvokeFunction` en `arn:aws:lambda:eu-west-1:701055077130:function:mcp-incidents-kb-wrapper`

Para desplegar la Lambda (solo una vez):
- CloudFormation (crear/actualizar stacks)
- Lambda (crear/actualizar funciones)
- IAM (crear roles y políticas)
- S3 (para SAM artifacts)

## 🚀 Instalación

### 1. Instalar Dependencias

```bash
cd mcp-incidents-lambda
npm install
```

### 2. Compilar TypeScript

```bash
npm run build
```

Esto genera `dist/index-local.js` que es el servidor MCP local.

### 3. Desplegar Lambda Wrapper (Solo Primera Vez)

```bash
sam deploy \
  --template-file infrastructure/template.yaml \
  --stack-name mcp-incidents-server \
  --capabilities CAPABILITY_IAM \
  --region eu-west-1 \
  --resolve-s3
```

### 4. Configurar Cline

Edita el archivo de configuración de Cline:

**macOS/Linux:**
```bash
~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
```

**Windows:**
```bash
%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
```

**Contenido:**
```json
{
  "mcpServers": {
    "incidents-analyzer": {
      "command": "node",
      "args": [
        "/ruta/completa/a/mcp-incidents-lambda/dist/index-local.js"
      ],
      "env": {
        "AWS_REGION": "eu-west-1",
        "LAMBDA_FUNCTION_NAME": "mcp-incidents-kb-wrapper"
      }
    }
  }
}
```

**Importante:** Reemplaza `/ruta/completa/a/` con la ruta absoluta a tu proyecto.

### 5. Reiniciar VS Code

Cierra y abre VS Code completamente para que Cline cargue la nueva configuración.

## 🧪 Verificación

### 1. Verificar que Cline Detecta el Servidor

En Cline, deberías ver el servidor `incidents-analyzer` disponible en la lista de servidores MCP.

### 2. Probar la Herramienta

Desde Cline, ejecuta:

```
Busca incidencias similares a: "El servicio de autenticación OAuth está fallando intermitentemente"
```

Cline debería:
1. Detectar que puede usar la herramienta `search_similar_incidents`
2. Invocar el servidor MCP local
3. El servidor invoca la Lambda
4. La Lambda consulta Bedrock Knowledge Base
5. Claude analiza los resultados
6. Cline presenta el análisis completo

### 3. Verificar Logs

**Logs del servidor local:**
Cline muestra los logs en su interfaz.

**Logs de Lambda:**
```bash
aws logs tail /aws/lambda/mcp-incidents-kb-wrapper --follow
```

## 📊 Uso

### Herramienta Disponible

**`search_similar_incidents`**

Busca incidencias similares en la base de conocimiento y proporciona diagnóstico, causa raíz y recomendaciones.

**Parámetros:**
- `query` (requerido): Descripción detallada de la incidencia
- `optimize_query` (opcional): Si true, optimiza la consulta con IA (default: true)
- `max_results` (opcional): Número máximo de resultados (1-10, default: 5)

**Ejemplo de uso desde Cline:**

```typescript
use_mcp_tool({
  server_name: "incidents-analyzer",
  tool_name: "search_similar_incidents",
  arguments: {
    query: "El servidor web no responde en el puerto 443. Los logs muestran errores de SSL.",
    optimize_query: true,
    max_results: 5
  }
})
```

**Respuesta:**
```json
{
  "diagnosis": "Análisis detallado del problema...",
  "root_cause": "Causa raíz identificada...",
  "recommended_actions": [
    "Paso 1: ...",
    "Paso 2: ...",
    "Paso 3: ..."
  ],
  "confidence_score": 0.85,
  "similar_incidents": [
    {
      "incident_id": "INC-12345",
      "title": "Error SSL en servidor web",
      "description": "...",
      "similarity_score": 0.89,
      "resolution": "...",
      "resolution_time_minutes": 45
    }
  ],
  "metadata": {
    "processing_time_ms": 23737,
    "kb_query_time_ms": 382,
    "llm_analysis_time_ms": 20566,
    "total_tokens": 3317
  }
}
```

## 🛠️ Desarrollo

### Estructura del Proyecto

```
mcp-incidents-lambda/
├── src/
│   ├── index.ts                    # Handler Lambda
│   ├── index-local.ts              # Servidor MCP local ⭐
│   ├── tools/
│   │   └── search-similar-incidents.ts
│   ├── services/
│   │   ├── bedrock-kb-service.ts   # Cliente Bedrock KB
│   │   └── bedrock-llm-service.ts  # Cliente Claude
│   ├── types/
│   │   ├── mcp.ts                  # Tipos MCP
│   │   └── incidents.ts            # Tipos de incidencias
│   └── utils/
│       └── logger.ts
├── infrastructure/
│   └── template.yaml               # SAM template
├── dist/                           # Código compilado
│   ├── index.js                    # Lambda handler
│   └── index-local.js              # Servidor MCP ⭐
├── package.json
├── tsconfig.json
└── README.md
```

### Scripts Disponibles

```bash
# Compilar TypeScript
npm run build

# Compilar en modo watch
npm run watch

# Limpiar build
npm run clean

# Desplegar Lambda (solo cuando cambies la Lambda)
sam deploy \
  --template-file infrastructure/template.yaml \
  --stack-name mcp-incidents-server \
  --capabilities CAPABILITY_IAM \
  --region eu-west-1 \
  --resolve-s3
```

### Modificar el Servidor Local

1. Edita `src/index-local.ts`
2. Compila: `npm run build`
3. Reinicia VS Code para que Cline recargue el servidor

### Modificar la Lambda

1. Edita archivos en `src/` (excepto `index-local.ts`)
2. Compila: `npm run build`
3. Despliega: `sam deploy ...`

## 🔧 Troubleshooting

### Error: "Cannot find module '@modelcontextprotocol/sdk'"

```bash
cd mcp-incidents-lambda
npm install
npm run build
```

### Error: "AccessDeniedException" al invocar Lambda

Verifica tus credenciales y permisos:

```bash
aws sts get-caller-identity
aws lambda get-function --function-name mcp-incidents-kb-wrapper
```

Si no tienes permisos, contacta al administrador AWS para que te añada al grupo `MCPIncidentsUsers`.

### Error: "Lambda function not found"

La Lambda no está desplegada. Despliégala:

```bash
sam deploy \
  --template-file infrastructure/template.yaml \
  --stack-name mcp-incidents-server \
  --capabilities CAPABILITY_IAM \
  --region eu-west-1 \
  --resolve-s3
```

### Cline no detecta el servidor MCP

1. Verifica la ruta en `cline_mcp_settings.json` (debe ser absoluta)
2. Verifica que `dist/index-local.js` existe
3. Reinicia VS Code completamente
4. Revisa los logs de Cline para ver errores

### Error: "User is not authorized to perform: bedrock:InvokeModel"

Los permisos IAM de la Lambda necesitan actualizarse. El template ya incluye los permisos correctos con wildcards para todas las regiones:

```yaml
Resource:
  - 'arn:aws:bedrock:*::foundation-model/*'
  - !Sub 'arn:aws:bedrock:*:${AWS::AccountId}:inference-profile/*'
```

Redespliega la Lambda para aplicar los permisos actualizados.

## 📊 Monitoreo

### Ver Logs de Lambda

```bash
# Tiempo real
aws logs tail /aws/lambda/mcp-incidents-kb-wrapper --follow

# Buscar errores
aws logs filter-log-events \
  --log-group-name /aws/lambda/mcp-incidents-kb-wrapper \
  --filter-pattern "ERROR"
```

### Métricas en CloudWatch

El stack incluye alarmas automáticas:
- **mcp-incidents-kb-wrapper-high-error-rate**: >5 errores en 5 minutos
- **mcp-incidents-kb-wrapper-high-duration**: Duración promedio >60 segundos

```bash
# Ver métricas de invocaciones
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=mcp-incidents-kb-wrapper \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

## 💰 Costos Estimados

### Escenario: 500 consultas/mes

| Componente | Costo Mensual |
|------------|---------------|
| Lambda Invocations | $0.00 (free tier) |
| Lambda Duration (500 × 20s × 1GB) | $0.17 |
| Bedrock KB Retrieve (500 queries) | $0.50 |
| Bedrock Claude 4.5 (~1.5M tokens) | $4.50 |
| CloudWatch Logs (500 MB) | $0.25 |
| **TOTAL** | **~$5.42/mes** |

### Escenario: 2,000 consultas/mes

| Componente | Costo Mensual |
|------------|---------------|
| Lambda Invocations | $0.00 (free tier) |
| Lambda Duration (2,000 × 20s × 1GB) | $0.67 |
| Bedrock KB Retrieve (2,000 queries) | $2.00 |
| Bedrock Claude 4.5 (~6M tokens) | $18.00 |
| CloudWatch Logs (2 GB) | $1.00 |
| **TOTAL** | **~$21.67/mes** |

## 🗑️ Limpieza

### Eliminar el Stack

```bash
aws cloudformation delete-stack \
  --stack-name mcp-incidents-server \
  --region eu-west-1

# Esperar a que se complete
aws cloudformation wait stack-delete-complete \
  --stack-name mcp-incidents-server \
  --region eu-west-1
```

### Eliminar Configuración de Cline

Edita `cline_mcp_settings.json` y elimina la entrada `incidents-analyzer`.

## 📚 Documentación Adicional

- [Arquitectura Detallada](./ARQUITECTURA_LOCAL_MCP.md)
- [Guía de Testing](./GUIA_TESTING.md)
- [Configuración de Cline](./CONFIGURACION_CLINE.md)
- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)
- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)

## 🎯 Próximos Pasos

- [ ] Añadir herramienta para crear nuevas incidencias
- [ ] Implementar caché local para reducir costos
- [ ] Añadir herramienta para actualizar incidencias resueltas
- [ ] Implementar métricas de uso
- [ ] Crear dashboard de monitoreo

## 🤝 Soporte

Para problemas o preguntas:
1. Revisar la sección de Troubleshooting
2. Verificar logs en CloudWatch
3. Consultar [ARQUITECTURA_LOCAL_MCP.md](./ARQUITECTURA_LOCAL_MCP.md)

## 📝 Licencia

MIT
