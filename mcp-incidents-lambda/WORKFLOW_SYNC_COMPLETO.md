# Workflow Completo de Sincronización DynamoDB → S3 → Knowledge Base

## Resumen del Problema Descubierto

**IMPORTANTE**: No existe sincronización automática entre S3 y Bedrock Knowledge Base. Cuando se suben archivos a S3, estos NO se indexan automáticamente en la KB. Es necesario **iniciar manualmente un Ingestion Job** para que la KB procese los nuevos archivos.

## Arquitectura del Flujo Completo

```
┌─────────────────┐
│   DynamoDB      │
│   (incidents)   │
│                 │
│ Status: CLOSED  │
│ kb_sync_status: │
│   synced: false │
└────────┬────────┘
         │
         │ 1. Lambda Batch Sync (cada hora)
         │    incident-kb-batch-sync
         ▼
┌─────────────────────────────────────┐
│              S3 Bucket              │
│ incident-analyzer-dev-incidents-dev │
│                                     │
│  incidents/closed/                  │
│    ├── INC-xxx-1.json              │
│    ├── INC-xxx-2.json              │
│    └── INC-xxx-3.json              │
└────────┬────────────────────────────┘
         │
         │ 2. Ingestion Job (MANUAL)
         │    StartIngestionJob API
         ▼
┌─────────────────────────────────────┐
│      Bedrock Knowledge Base         │
│         LPR1PEW0LN                  │
│                                     │
│  Data Source: AJIJE6BWIV            │
│  Backend: RDS Aurora                │
│                                     │
│  ✓ Archivos indexados               │
│  ✓ Embeddings generados             │
│  ✓ Disponibles para búsqueda        │
└─────────────────────────────────────┘
```

## Componentes del Sistema

### 1. Lambda de Sincronización Batch (incident-kb-batch-sync)

**Función**: Sincroniza incidencias cerradas desde DynamoDB a S3

**Trigger**: EventBridge Schedule (cada hora)

**Proceso**:
1. Query DynamoDB: `status = CLOSED AND kb_sync_status.synced = false`
2. Transforma cada incidencia a formato JSON optimizado para KB
3. Sube a S3: `s3://incident-analyzer-dev-incidents-dev/incidents/closed/{incident_id}.json`
4. Actualiza DynamoDB: `kb_sync_status.synced = true`
5. Publica métricas a CloudWatch

**Limitaciones**:
- Procesa máximo 50 incidencias por ejecución
- NO inicia el ingestion job automáticamente

### 2. Ingestion Job (Manual)

**Función**: Indexa archivos de S3 en la Knowledge Base

**API**: `BedrockAgentClient.StartIngestionJobCommand`

**Proceso**:
1. Lee archivos del prefijo configurado en el Data Source
2. Genera embeddings con el modelo configurado
3. Almacena en RDS Aurora (backend de la KB)
4. Actualiza índice para búsquedas

**Estado Actual**:
- Último ingestion job: 1 de octubre de 2025
- **NO hay sincronización automática configurada**
- Debe iniciarse manualmente después de cada batch sync

## Herramientas MCP Disponibles

### 1. force_kb_sync

**Propósito**: Fuerza la sincronización DynamoDB → S3

**Uso**:
```typescript
{
  "tool": "force_kb_sync",
  "arguments": {
    "wait_for_completion": true  // Espera a que termine
  }
}
```

**Resultado**:
```json
{
  "status": "completed",
  "lambda_execution": {
    "function_name": "incident-kb-batch-sync",
    "status_code": 200
  },
  "sync_results": {
    "successfully_synced": 5,
    "failed": 0,
    "total_processed": 5
  }
}
```

**Limitación**: Solo sincroniza a S3, NO inicia ingestion job

### 2. sync_and_ingest (NUEVO)

**Propósito**: Workflow completo DynamoDB → S3 → KB

**Uso**:
```typescript
{
  "tool": "sync_and_ingest",
  "arguments": {
    "wait_for_sync": true,      // Espera sync a S3
    "wait_for_ingestion": true  // Espera ingestion job
  }
}
```

**Proceso**:
1. Invoca `incident-kb-batch-sync` Lambda
2. Espera resultado del sync a S3
3. Inicia ingestion job en la KB
4. Monitorea estado del ingestion job
5. Retorna resultado completo

**Resultado**:
```json
{
  "status": "completed",
  "sync_phase": {
    "successfully_synced": 5,
    "failed": 0,
    "total_processed": 5
  },
  "ingestion_phase": {
    "job_id": "ABCD1234",
    "status": "COMPLETE",
    "statistics": {
      "numberOfDocumentsScanned": 5,
      "numberOfNewDocumentsIndexed": 5,
      "numberOfModifiedDocumentsIndexed": 0,
      "numberOfDocumentsDeleted": 0,
      "numberOfDocumentsFailed": 0
    }
  },
  "total_duration_seconds": 45
}
```

## Configuración Actual

### DynamoDB Table
- **Nombre**: `incidents`
- **GSI-2**: `status-priority-index`
- **Campo clave**: `kb_sync_status.synced` (boolean)

### S3 Bucket
- **Nombre**: `incident-analyzer-dev-incidents-dev`
- **Prefijo para incidencias cerradas**: `incidents/closed/`
- **Formato**: JSON con metadata optimizada para búsqueda

### Bedrock Knowledge Base
- **ID**: `LPR1PEW0LN`
- **Nombre**: `incident-analyzer-dev-incidents-kb`
- **Data Source ID**: `AJIJE6BWIV`
- **Prefijo S3**: `incidents/` (incluye closed/)
- **Backend**: RDS Aurora
- **Modelo Embeddings**: Amazon Titan

### Lambda Batch Sync
- **Nombre**: `incident-kb-batch-sync`
- **Runtime**: Node.js 20.x
- **Timeout**: 5 minutos
- **Memory**: 512 MB
- **Schedule**: `cron(0 * * * ? *)` (cada hora)

## Flujo de Trabajo Recomendado

### Opción 1: Sincronización Manual Completa

```bash
# Usar la herramienta sync_and_ingest desde Cline
{
  "tool": "sync_and_ingest",
  "arguments": {
    "wait_for_sync": true,
    "wait_for_ingestion": true
  }
}
```

### Opción 2: Sincronización por Fases

```bash
# Fase 1: Sync a S3
{
  "tool": "force_kb_sync",
  "arguments": {
    "wait_for_completion": true
  }
}

# Fase 2: Iniciar ingestion manualmente desde AWS Console
# O usar AWS CLI:
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id LPR1PEW0LN \
  --data-source-id AJIJE6BWIV \
  --description "Manual sync after batch processing"
```

### Opción 3: Automatización Futura (Recomendado)

Modificar la Lambda `incident-kb-batch-sync` para que:
1. Sincronice incidencias a S3
2. **Automáticamente inicie un ingestion job** si hubo cambios
3. Monitoree el estado del ingestion job
4. Publique métricas completas

**Ventajas**:
- Sincronización completamente automática
- Sin intervención manual
- Métricas end-to-end

**Implementación**:
```typescript
// Al final de kb-batch-sync.ts
if (successfullySynced > 0) {
  const bedrockAgent = new BedrockAgentClient({ region: AWS_REGION });
  
  await bedrockAgent.send(new StartIngestionJobCommand({
    knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID,
    dataSourceId: process.env.DATA_SOURCE_ID,
    description: `Auto-triggered after syncing ${successfullySynced} incidents`
  }));
}
```

## Monitoreo y Métricas

### CloudWatch Metrics

**Namespace**: `IncidentKBSync`

**Métricas disponibles**:
- `IncidentsSynced`: Número de incidencias sincronizadas
- `SyncErrors`: Errores durante sincronización
- `SyncDuration`: Duración del proceso
- `IngestionJobsStarted`: Jobs de ingestion iniciados
- `IngestionJobsCompleted`: Jobs completados exitosamente

### CloudWatch Alarms

1. **SyncErrorsAlarm**: Alerta si hay errores en sync
2. **IngestionFailureAlarm**: Alerta si falla ingestion job
3. **SyncDurationAlarm**: Alerta si el proceso tarda demasiado

### Dashboard

Ver métricas en: CloudWatch → Dashboards → `IncidentKBSyncDashboard`

## Troubleshooting

### Problema: Archivos en S3 pero no aparecen en búsquedas

**Causa**: No se ha ejecutado ingestion job después del sync

**Solución**:
```bash
# Opción 1: Usar sync_and_ingest
{
  "tool": "sync_and_ingest",
  "arguments": {}
}

# Opción 2: Iniciar ingestion manualmente
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id LPR1PEW0LN \
  --data-source-id AJIJE6BWIV
```

### Problema: Ingestion job falla

**Causas comunes**:
1. Formato JSON inválido en archivos S3
2. Archivos demasiado grandes
3. Problemas de permisos IAM

**Verificación**:
```bash
# Ver detalles del último job
aws bedrock-agent get-ingestion-job \
  --knowledge-base-id LPR1PEW0LN \
  --data-source-id AJIJE6BWIV \
  --ingestion-job-id <JOB_ID>

# Ver logs de la KB
aws logs tail /aws/bedrock/knowledgebases/LPR1PEW0LN --follow
```

### Problema: kb_sync_status no se actualiza

**Causa**: Error en Lambda después de subir a S3

**Verificación**:
```bash
# Ver logs de la Lambda
aws logs tail /aws/lambda/incident-kb-batch-sync --follow

# Verificar estado en DynamoDB
aws dynamodb get-item \
  --table-name incidents \
  --key '{"incident_id": {"S": "INC-xxx"}}'
```

## Costos Estimados

### Por Ejecución Completa (50 incidencias)

1. **Lambda Batch Sync**: ~$0.0001
2. **S3 Storage**: ~$0.0012/mes (50 archivos × 5KB)
3. **Ingestion Job**: ~$0.05 (procesamiento + embeddings)
4. **RDS Aurora**: Incluido en costo base de KB
5. **CloudWatch**: ~$0.01 (logs + métricas)

**Total por sync completo**: ~$0.06

### Mensual (con schedule cada hora)

- 24 ejecuciones/día × 30 días = 720 ejecuciones
- Asumiendo 10 incidencias nuevas/día promedio
- **Costo estimado**: ~$18/mes

## Próximos Pasos

1. ✅ Implementar herramienta `sync_and_ingest`
2. ✅ Actualizar MCP server con nueva herramienta
3. ✅ Documentar workflow completo
4. ⏳ Probar workflow end-to-end
5. ⏳ Considerar automatización completa en Lambda
6. ⏳ Configurar alertas adicionales
7. ⏳ Optimizar costos si es necesario

## Referencias

- [Bedrock Knowledge Base API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent_StartIngestionJob.html)
- [Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/NotificationHowTo.html)
