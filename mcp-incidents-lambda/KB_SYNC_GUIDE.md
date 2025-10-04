# Guía de Sincronización con Knowledge Base

## 📋 Descripción General

Este módulo sincroniza automáticamente las incidencias cerradas desde DynamoDB hacia la Knowledge Base de Bedrock a través de S3, permitiendo que futuras búsquedas encuentren estas resoluciones y mejoren continuamente la calidad de las recomendaciones.

## 🏗️ Arquitectura

```
EventBridge Rule (cada hora)
    ↓
Lambda (incident-kb-batch-sync)
    ↓ Query DynamoDB
DynamoDB (incidents table)
    ↓ Filtrar CLOSED no sincronizadas
Lambda procesa lote (max 50)
    ↓ Transforma a formato KB
S3 (incident-analyzer-dev-incidents-dev/closed-incidents/)
    ↓ Sync automático (cada 5 min)
Bedrock Knowledge Base (LPR1PEW0LN)
    ↓
Disponible para búsquedas futuras
```

## ⏱️ Latencia

- **Máxima**: 65 minutos (60 min hasta batch + 5 min sync KB)
- **Típica**: 30-35 minutos
- **Configurable**: Se puede cambiar a `rate(30 minutes)` o `rate(15 minutes)`

## 📊 Componentes

### 1. Lambda Function: `incident-kb-batch-sync`

**Ubicación**: `src/kb-batch-sync.ts`

**Responsabilidades**:
- Buscar incidencias cerradas no sincronizadas en DynamoDB
- Transformar cada incidencia a formato optimizado para KB
- Guardar documentos JSON en S3
- Actualizar estado de sincronización en DynamoDB
- Publicar métricas a CloudWatch

**Configuración**:
```yaml
Timeout: 300 segundos (5 minutos)
Memory: 1024 MB
Runtime: Node.js 20.x
Architecture: ARM64
```

**Variables de Entorno**:
- `INCIDENTS_TABLE`: Nombre de la tabla DynamoDB (default: `incidents`)
- `S3_BUCKET`: Bucket S3 para documentos KB (default: `incident-analyzer-dev-incidents-dev`)
- `S3_PREFIX`: Prefijo para documentos (default: `closed-incidents/`)
- `KB_ID`: ID de Knowledge Base (default: `LPR1PEW0LN`)
- `BATCH_SIZE`: Máximo de incidencias por ejecución (default: `50`)
- `MAX_SYNC_ATTEMPTS`: Intentos máximos antes de omitir (default: `3`)

### 2. EventBridge Rule

**Schedule**: `rate(1 hour)` (configurable)
**Target**: Lambda `incident-kb-batch-sync`
**Estado**: Habilitado por defecto

### 3. CloudWatch Dashboard

**Nombre**: `incident-kb-sync-dashboard`

**Widgets**:
- Incidents Sync Status (Found, Synced, Errors, Skipped)
- Sync Duration
- Lambda Metrics (Invocations, Errors, Throttles)
- Recent Successful Syncs (logs)
- Recent Failed Syncs (logs)

### 4. CloudWatch Alarms

**Alarmas configuradas**:
1. `incident-kb-batch-sync-errors`: Errores de Lambda > 5 en 1 hora
2. `incident-kb-batch-sync-high-duration`: Duración > 4 minutos
3. `incident-kb-sync-high-failures`: Fallos de sincronización > 10 en 1 hora

## 📝 Formato de Documento KB

Cada incidencia se transforma en un documento JSON optimizado para búsqueda:

```json
{
  "incident_id": "INC-1759575610487-WC5F2I",
  "external_id": "JIRA-12345",
  "source_system": "JIRA",
  "source_url": "https://jira.company.com/browse/JIRA-12345",
  
  "title": "Database connection timeout in production",
  "description": "Production API experiencing timeouts...",
  "category": "Infrastructure",
  "severity": "HIGH",
  "priority": "P1",
  
  "affected_systems": ["API Gateway", "Database"],
  "environment": "PRODUCTION",
  "error_message": "Connection timeout after 30s",
  
  "root_cause": "Pool de conexiones insuficiente para el volumen de tráfico",
  "resolution": "Se aumentó el tamaño del pool de conexiones...",
  "resolution_type": "FIXED",
  "resolution_steps": [
    "Aumentar max_connections de 10 a 50",
    "Implementar circuit breaker",
    "Añadir métricas de monitoreo"
  ],
  
  "code_changes": [
    {
      "file": "src/config/database.ts",
      "description": "Aumentar tamaño del pool",
      "diff": "- max_connections: 10\n+ max_connections: 50"
    }
  ],
  
  "resolved_by": "developer@company.com",
  "resolved_at": "2025-01-04T12:00:00Z",
  "resolution_time_minutes": 120,
  
  "tags": ["database", "timeout", "production"],
  "synced_to_kb_at": "2025-01-04T13:00:00Z"
}
```

## 🔄 Flujo de Sincronización

### 1. Cierre de Incidencia

Cuando se cierra una incidencia usando `close_incident`:

```typescript
// El servicio establece automáticamente
kb_sync_status: {
  synced: false,
  sync_attempts: 0
}
```

### 2. Detección por Lambda

Cada hora, la Lambda ejecuta:

```typescript
// Query en DynamoDB usando GSI-2
SELECT * FROM incidents
WHERE status = 'CLOSED'
  AND (kb_sync_status.synced = false OR kb_sync_status IS NULL)
LIMIT 50
```

### 3. Procesamiento

Para cada incidencia encontrada:

```typescript
1. Verificar intentos < MAX_SYNC_ATTEMPTS
2. Transformar a formato KB
3. Guardar en S3: s3://bucket/incidents/{incident_id}.json
4. Actualizar DynamoDB:
   - Si éxito: kb_sync_status.synced = true
   - Si fallo: kb_sync_status.sync_attempts++
```

### 4. Ingestión en KB

Bedrock Knowledge Base detecta automáticamente nuevos archivos en S3 y los ingesta cada 5 minutos.

## 🚀 Despliegue

### Requisitos Previos

1. Tabla DynamoDB `incidents` desplegada
2. Bucket S3 `incident-analyzer-dev-incidents-dev` existente
3. Knowledge Base `LPR1PEW0LN` configurada con data source apuntando a `closed-incidents/` prefix
4. AWS CLI y SAM CLI instalados
5. Credenciales AWS configuradas

### Pasos de Despliegue

```bash
# 1. Navegar al directorio
cd mcp-incidents-lambda

# 2. Instalar dependencias (si no está hecho)
npm install

# 3. Ejecutar script de despliegue
./infrastructure/deploy-kb-sync.sh
```

### Despliegue Manual

```bash
# Compilar TypeScript
npm run build

# Desplegar con SAM
sam deploy \
  --template-file infrastructure/kb-sync-template.yaml \
  --stack-name incident-kb-sync-stack \
  --region eu-west-1 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    IncidentsTableName=incidents \
    S3BucketName=incident-analyzer-dev-incidents-dev \
    KnowledgeBaseId=LPR1PEW0LN \
    SyncSchedule="rate(1 hour)"
```

### Configuración Personalizada

Para cambiar la frecuencia de sincronización:

```bash
# Cada 30 minutos
SyncSchedule="rate(30 minutes)"

# Cada 15 minutos
SyncSchedule="rate(15 minutes)"

# Diariamente a las 2 AM
SyncSchedule="cron(0 2 * * ? *)"
```

## 🧪 Testing

### Test Manual

```bash
# Invocar Lambda manualmente
aws lambda invoke \
  --function-name incident-kb-batch-sync \
  --region eu-west-1 \
  response.json

# Ver resultado
cat response.json
```

### Verificar Sincronización

```bash
# 1. Verificar que el documento está en S3
aws s3 ls s3://incident-analyzer-dev-incidents-dev/closed-incidents/

# 2. Descargar y ver contenido
aws s3 cp s3://incident-analyzer-dev-incidents-dev/closed-incidents/INC-XXX.json -

# 3. Verificar estado en DynamoDB
aws dynamodb get-item \
  --table-name incidents \
  --key '{"incident_id":{"S":"INC-XXX"},"sk":{"S":"METADATA"}}' \
  --query 'Item.kb_sync_status'
```

### Test End-to-End

```bash
# 1. Crear incidencia de test y cerrarla
# (usar herramientas MCP desde Cline)

# 2. Esperar hasta 65 minutos

# 3. Buscar en Knowledge Base
aws bedrock-agent-runtime retrieve \
  --knowledge-base-id LPR1PEW0LN \
  --retrieval-query text="test incident description" \
  --region eu-west-1
```

## 📊 Monitoreo

### Ver Logs en Tiempo Real

```bash
aws logs tail /aws/lambda/incident-kb-batch-sync \
  --follow \
  --region eu-west-1
```

### Ver Métricas

```bash
# Incidencias sincronizadas en la última hora
aws cloudwatch get-metric-statistics \
  --namespace IncidentManagement/KBSync \
  --metric-name IncidentsSynced \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum \
  --region eu-west-1
```

### Dashboard

Acceder al dashboard en CloudWatch:
```
https://console.aws.amazon.com/cloudwatch/home?region=eu-west-1#dashboards:name=incident-kb-sync-dashboard
```

## 🔧 Troubleshooting

### Problema: Incidencias no se sincronizan

**Diagnóstico**:
```bash
# 1. Verificar que la Lambda se está ejecutando
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=incident-kb-batch-sync \
  --start-time $(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum

# 2. Ver logs de errores
aws logs filter-log-events \
  --log-group-name /aws/lambda/incident-kb-batch-sync \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '1 hour ago' +%s)000
```

**Soluciones**:
- Verificar permisos IAM de la Lambda
- Verificar que la tabla DynamoDB existe
- Verificar que el bucket S3 existe y es accesible

### Problema: Errores de sincronización

**Diagnóstico**:
```bash
# Ver incidencias con errores
aws dynamodb scan \
  --table-name incidents \
  --filter-expression "attribute_exists(kb_sync_status.last_sync_error)" \
  --projection-expression "incident_id,kb_sync_status"
```

**Soluciones**:
- Revisar `kb_sync_status.last_sync_error` en DynamoDB
- Verificar formato de datos en la incidencia
- Verificar permisos de escritura en S3

### Problema: Lambda timeout

**Diagnóstico**:
```bash
# Ver duraciones de ejecución
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=incident-kb-batch-sync \
  --start-time $(date -u -d '6 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Maximum,Average
```

**Soluciones**:
- Reducir `BATCH_SIZE` (default: 50)
- Aumentar timeout de Lambda (max: 900s)
- Aumentar memoria de Lambda

## 💰 Costos

### Escenario: 50 incidencias cerradas/mes

**Lambda**:
- 720 ejecuciones/mes (24/día × 30 días)
- Duración promedio: 5 segundos
- Memoria: 1024 MB
- **Costo**: $0.0024/mes

**DynamoDB**:
- 36,000 lecturas/mes
- 50 escrituras/mes
- **Costo**: $0.009/mes

**S3**:
- 50 PUT requests
- 250 KB storage
- **Costo**: $0.0003/mes

**CloudWatch**:
- Logs: 7 días retención
- Métricas personalizadas
- **Costo**: $0.002/mes

**Total**: ~$0.014/mes (1.4 centavos)

## 📚 Referencias

- [DynamoDB Query](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html)
- [S3 PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)
- [Bedrock Knowledge Base](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)
- [EventBridge Schedule](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html)
- [CloudWatch Metrics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/working_with_metrics.html)

## 🎯 Próximos Pasos

1. ✅ Lambda de sincronización implementada
2. ✅ CloudFormation template creado
3. ✅ Script de despliegue listo
4. ⏳ Desplegar en AWS
5. ⏳ Monitorear primera ejecución
6. ⏳ Verificar sincronización con KB
7. ⏳ Ajustar frecuencia si es necesario
8. ⏳ Configurar alertas adicionales si es necesario

## 📞 Soporte

Para problemas o preguntas:
1. Revisar logs en CloudWatch
2. Consultar dashboard de métricas
3. Verificar alarmas activas
4. Revisar esta documentación
