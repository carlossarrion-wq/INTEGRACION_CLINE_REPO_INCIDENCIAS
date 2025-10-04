# Configuración de Cline para Servidor MCP Local de Incidencias

## 🎯 Arquitectura Actual

El servidor MCP se ejecuta **localmente** en tu máquina y se comunica con una Lambda en AWS para acceder a Bedrock Knowledge Base.

```
Cline (VS Code) → Servidor MCP Local (Node.js) → Lambda (AWS) → Bedrock KB
```

## 📋 Prerequisitos

1. **Node.js 20+** instalado
2. **AWS CLI** configurado con credenciales válidas
3. **Permisos** para invocar la Lambda `mcp-incidents-kb-wrapper`
4. **Proyecto compilado**: `npm run build` ejecutado

## 🔧 Configuración

### 1. Ubicación del Archivo de Configuración

**macOS/Linux:**
```bash
~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
```

**Windows:**
```bash
%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
```

### 2. Contenido de la Configuración

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

**⚠️ Importante**: 
- Reemplaza la ruta en `args` con la **ruta absoluta** a tu proyecto
- Asegúrate de que el archivo `dist/index-local.js` existe (ejecuta `npm run build`)

### 3. Verificar Credenciales AWS

El servidor local usa tus credenciales AWS configuradas:

```bash
# Verificar que AWS CLI está configurado
aws sts get-caller-identity

# Verificar acceso a la Lambda
aws lambda get-function --function-name mcp-incidents-kb-wrapper --region eu-west-1
```

### 4. Reiniciar VS Code

Cierra y abre VS Code completamente para que Cline cargue la nueva configuración.

## 🛠️ Herramienta Disponible

### `search_similar_incidents`

Busca incidencias similares en la base de conocimiento y proporciona diagnóstico, causa raíz y recomendaciones basadas en casos históricos.

**Parámetros**:
- `query` (string, requerido): Descripción detallada de la incidencia a analizar
- `optimize_query` (boolean, opcional): Si true, optimiza la consulta con IA antes de buscar (default: true)
- `max_results` (number, opcional): Número máximo de incidencias similares a retornar (1-10, default: 5)

**Ejemplo de uso desde Cline**:

```
Usuario: "Busca incidencias similares a: El servicio de autenticación OAuth está fallando intermitentemente. Algunos usuarios pueden iniciar sesión correctamente mientras que otros reciben errores 500."

Cline ejecutará automáticamente:
1. Detectar la herramienta search_similar_incidents
2. Invocar el servidor MCP local
3. El servidor invoca la Lambda en AWS
4. La Lambda consulta Bedrock Knowledge Base
5. Claude Sonnet 4.5 analiza los resultados
6. Cline presenta el análisis completo
```

**Respuesta típica**:
```json
{
  "diagnosis": "El sistema de autenticación OAuth presenta fallos intermitentes...",
  "root_cause": "Problema de gestión de sesiones concurrentes...",
  "recommended_actions": [
    "Paso 1: Revisar logs del servicio OAuth...",
    "Paso 2: Verificar configuración de tokens...",
    "..."
  ],
  "confidence_score": 0.85,
  "similar_incidents": [
    {
      "incident_id": "INC-12345",
      "title": "Error OAuth intermitente",
      "similarity_score": 0.89,
      "resolution": "Implementar invalidación de sesiones previas"
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

## 🧪 Verificación

### 1. Verificar que Cline Detecta el Servidor

En la interfaz de Cline, deberías ver:
- El servidor `incidents-analyzer` en la lista de servidores MCP
- Estado: Conectado ✅

### 2. Probar Manualmente el Servidor Local

```bash
# Ejecutar el servidor directamente
cd mcp-incidents-lambda
node dist/index-local.js

# El servidor esperará comandos MCP por stdin
# Puedes enviar comandos JSON manualmente para probar
```

### 3. Ver Logs

**Logs del servidor local:**
- Cline muestra los logs en su interfaz
- También se escriben a stderr

**Logs de Lambda en AWS:**
```bash
aws logs tail /aws/lambda/mcp-incidents-kb-wrapper --follow --region eu-west-1
```

## 🔐 Seguridad

### Credenciales AWS

- Las credenciales AWS **nunca salen de tu máquina**
- Se usan las credenciales configuradas en `~/.aws/credentials`
- El servidor local usa AWS SDK con autenticación IAM

### Permisos Necesarios

Tu usuario AWS necesita:
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

## ❓ Solución de Problemas

### Cline no detecta el servidor

1. **Verifica la ruta** en `cline_mcp_settings.json` (debe ser absoluta)
2. **Verifica que existe** `dist/index-local.js`:
   ```bash
   ls -la mcp-incidents-lambda/dist/index-local.js
   ```
3. **Recompila** si es necesario:
   ```bash
   cd mcp-incidents-lambda
   npm run build
   ```
4. **Reinicia VS Code** completamente

### Error: "Cannot find module '@modelcontextprotocol/sdk'"

```bash
cd mcp-incidents-lambda
npm install
npm run build
```

### Error: "AccessDeniedException" al invocar Lambda

```bash
# Verificar credenciales
aws sts get-caller-identity

# Verificar acceso a Lambda
aws lambda get-function --function-name mcp-incidents-kb-wrapper --region eu-west-1

# Si no tienes permisos, contacta al administrador AWS
```

### Error: "Lambda function not found"

La Lambda no está desplegada. Despliégala:

```bash
cd mcp-incidents-lambda
sam deploy \
  --template-file infrastructure/template.yaml \
  --stack-name mcp-incidents-server \
  --capabilities CAPABILITY_IAM \
  --region eu-west-1 \
  --resolve-s3
```

### El servidor se desconecta frecuentemente

1. **Verifica logs** en Cline para ver errores
2. **Aumenta timeout** en la configuración:
   ```json
   {
     "mcpServers": {
       "incidents-analyzer": {
         "command": "node",
         "args": ["..."],
         "env": {...},
         "timeout": 120000
       }
     }
   }
   ```

### Respuestas lentas

- **Normal**: La primera consulta puede tardar 20-30 segundos
- **Optimización de query**: Añade ~5 segundos
- **Búsqueda en KB**: ~500ms
- **Análisis con Claude**: 15-25 segundos

Para consultas más rápidas, desactiva la optimización:
```json
{
  "query": "tu consulta",
  "optimize_query": false
}
```

## 📊 Monitoreo

### Métricas Disponibles

**CloudWatch Alarms configuradas:**
- `mcp-incidents-kb-wrapper-high-error-rate`: >5 errores en 5 minutos
- `mcp-incidents-kb-wrapper-high-duration`: Duración promedio >60 segundos

**Ver métricas:**
```bash
# Invocaciones
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=mcp-incidents-kb-wrapper \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region eu-west-1

# Errores
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=mcp-incidents-kb-wrapper \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region eu-west-1
```

## 🔄 Actualización

### Actualizar el Servidor Local

1. Modifica `src/index-local.ts`
2. Recompila: `npm run build`
3. Reinicia VS Code

### Actualizar la Lambda

1. Modifica archivos en `src/` (excepto `index-local.ts`)
2. Recompila: `npm run build`
3. Despliega:
   ```bash
   sam deploy \
     --template-file infrastructure/template.yaml \
     --stack-name mcp-incidents-server \
     --capabilities CAPABILITY_IAM \
     --region eu-west-1 \
     --resolve-s3
   ```

## 💰 Costos

### Estimación Mensual

**500 consultas/mes**: ~$5.42
- Lambda: $0.17
- Bedrock KB: $0.50
- Claude 4.5: $4.50
- CloudWatch: $0.25

**2,000 consultas/mes**: ~$21.67
- Lambda: $0.67
- Bedrock KB: $2.00
- Claude 4.5: $18.00
- CloudWatch: $1.00

## 📚 Recursos Adicionales

- [README Principal](./README.md)
- [Arquitectura Detallada](./ARQUITECTURA_LOCAL_MCP.md)
- [Guía de Testing](./GUIA_TESTING.md)
- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)
- [Cline Documentation](https://docs.cline.bot/)

## 🎯 Próximos Pasos

1. ✅ Configurar Cline
2. ✅ Verificar conexión
3. ✅ Probar herramienta
4. ⏳ Usar en desarrollo real
5. ⏳ Monitorear uso y costos
6. ⏳ Añadir más herramientas según necesidad

---

**Nota**: Esta configuración usa un servidor MCP local que se comunica con AWS Lambda. Es más seguro y simple que la arquitectura remota, ya que las credenciales AWS nunca salen de tu máquina.
