# Implementación de Sincronización Batch con Knowledge Base

## 📋 Objetivo

Implementar un proceso batch periódico que sincronice incidencias cerradas desde DynamoDB hacia la Knowledge Base de Bedrock a través de S3.

## 🎯 Enfoque Seleccionado: Opción 3 - Batch Job Periódico

**Justificación**: El tiempo real no es crítico para este tipo de solución. Una sincronización cada hora es suficiente.

## 🏗️ Arquitectura Simplificada

```
EventBridge Rule (cada hora)
    ↓
Lambda (incident-kb-batch-sync)
    ↓ Query DynamoDB
DynamoDB (incidents)
    ↓ Filtrar CLOSED no sincronizadas
Lambda procesa lote
    ↓ Transforma y guarda
S3 (piloto-plan-pruebas-origen-datos-source/incidents/)
    ↓ Sync automático (cada 5 min)
Bedrock Knowledge Base (VH6SRH9ZNO)
```

**Latencia total**: Máximo 65 minutos (60 min hasta batch + 5 min sync KB)

## 📊 Modificaciones a DynamoDB

### Añadir Campo de Sincronización

```typescript
interface Incident {
  // ... campos existentes ...
  
  // Nuevo campo para tracking de sincronización
  kb_sync_status?: {
    synced: boolean;
    synced_at?: string;
    sync_attempts: number;
    last_sync_attempt?: string;
    last_sync_error?: string;
  };
}
```

### Actualizar al Cerrar Incidencia

```typescript
// Cuando se cierra una incidencia
await dynamodb.updateItem({
  TableName: 'incidents',
  Key: {
    incident_id: 'INC-12345',
    sk: 'METADATA'
  },
  UpdateExpression: `
    SET #status = :status,
        resolution = :resolution,
        resolved_at = :now,
        updated_at = :now,
        kb_sync_status = :sync_status
  `,
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':status': 'CLOSED',
    ':resolution': { /* ... */ },
    ':now': new Date().toISOString(),
    ':sync_status': {
      synced: false,
      sync_attempts: 0
    }
  }
});
```

## 🔧 Implementación Lambda Batch

### CloudFormation Template

```yaml
Resources:
  # Lambda para sincronización batch
  IncidentKBBatchSyncFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: incident-kb-batch-sync
      CodeUri: ../dist
      Handler: kb-batch-sync.handler
      Runtime: nodejs20.x
      Timeout: 300  # 5 minutos
      MemorySize: 1024
      Environment:
        Variables:
          INCIDENTS_TABLE: incidents
          S3_BUCKET: piloto-plan-pruebas-origen-datos-source
          S3_PREFIX: incidents/
          KB_ID: VH6SRH9ZNO
          BATCH_SIZE: '50'  # Procesar 50 incidencias por ejecución
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref IncidentsTable
        - S3CrudPolicy:
            BucketName: piloto-plan-pruebas-origen-datos-source
      Events:
        HourlySync:
          Type: Schedule
          Properties:
            Schedule: rate(1 hour)
            Description: Sincroniza incidencias cerradas con KB cada hora
            Enabled: true

  # CloudWatch Log Group
  BatchSyncLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub '/aws/lambda/${IncidentKBBatchSyncFunction}'
      RetentionInDays: 7

  # Alarma para errores
  BatchSyncErrorAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: incident-kb-batch-sync-errors
      AlarmDescription: Alert when batch sync has errors
      MetricName: Errors
      Namespace: AWS/Lambda
      Statistic: Sum
      Period: 3600
      EvaluationPeriods: 1
      Threshold: 5
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: FunctionName
          Value: !Ref IncidentKBBatchSyncFunction
```

### Código Lambda (kb-batch-sync.ts)

```typescript
import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });

const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE!;
const S3_BUCKET = process.env.S3_BUCKET!;
const S3_PREFIX = process.env.S3_PREFIX || 'incidents/';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50');

interface Incident {
  incident_id: string;
  sk: string;
  status: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  priority: string;
  external_id: string;
  source_system: string;
  source_url?: string;
  created_at: string;
  resolved_at?: string;
  affected_systems?: string[];
  environment?: string;
  error_message?: string;
  tags?: string[];
  resolution?: {
    resolved_by: string;
    resolved_at: string;
    resolution_type: string;
    description: string;
    root_cause?: string;
  };
  cline_work?: {
    analysis?: {
      root_cause?: string;
      diagnosis?: string;
    };
    solution?: {
      description: string;
      steps: string[];
      code_changes?: Array<{
        file: string;
        description: string;
      }>;
    };
  };
  kb_sync_status?: {
    synced: boolean;
    synced_at?: string;
    sync_attempts: number;
    last_sync_attempt?: string;
    last_sync_error?: string;
  };
}

interface SyncResult {
  total_found: number;
  successfully_synced: number;
  failed: number;
  errors: Array<{ incident_id: string; error: string }>;
}

export async function handler(): Promise<SyncResult> {
  console.log('Starting batch sync of closed incidents to KB');
  
  const startTime = Date.now();
  const result: SyncResult = {
    total_found: 0,
    successfully_synced: 0,
    failed: 0,
    errors: []
  };

  try {
    // 1. Buscar incidencias cerradas no sincronizadas
    const incidents = await findUnsyncedClosedIncidents();
    result.total_found = incidents.length;
    
    console.log(`Found ${incidents.length} unsynced closed incidents`);

    if (incidents.length === 0) {
      console.log('No incidents to sync');
      return result;
    }

    // 2. Procesar cada incidencia
    for (const incident of incidents) {
      try {
        await syncIncidentToKB(incident);
        result.successfully_synced++;
        
        console.log(`Successfully synced incident ${incident.incident_id}`);
      } catch (error) {
        result.failed++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push({
          incident_id: incident.incident_id,
          error: errorMessage
        });
        
        console.error(`Failed to sync incident ${incident.incident_id}:`, error);
        
        // Actualizar contador de intentos fallidos
        await updateSyncStatus(incident.incident_id, false, errorMessage);
      }
    }

    const duration = Date.now() - startTime;
    console.log('Batch sync completed', {
      duration_ms: duration,
      ...result
    });

    return result;
  } catch (error) {
    console.error('Batch sync failed:', error);
    throw error;
  }
}

async function findUnsyncedClosedIncidents(): Promise<Incident[]> {
  const incidents: Incident[] = [];
  
  // Query usando GSI-2 (status index)
  const command = new QueryCommand({
    TableName: INCIDENTS_TABLE,
    IndexName: 'GSI-2-status-priority',
    KeyConditionExpression: '#status = :status',
    FilterExpression: 'attribute_not_exists(kb_sync_status.synced) OR kb_sync_status.synced = :false',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: marshall({
      ':status': 'CLOSED',
      ':false': false
    }),
    Limit: BATCH_SIZE
  });

  const response = await dynamodb.send(command);
  
  if (response.Items) {
    for (const item of response.Items) {
      incidents.push(unmarshall(item) as Incident);
    }
  }

  return incidents;
}

async function syncIncidentToKB(incident: Incident): Promise<void> {
  // Transformar a formato optimizado para KB
  const kbDocument = {
    // Identificación
    incident_id: incident.incident_id,
    external_id: incident.external_id,
    source_system: incident.source_system,
    source_url: incident.source_url,
    
    // Información del problema
    title: incident.title,
    description: incident.description,
    category: incident.category,
    severity: incident.severity,
    priority: incident.priority,
    
    // Contexto técnico
    affected_systems: incident.affected_systems || [],
    environment: incident.environment,
    error_message: incident.error_message,
    
    // Resolución (lo más importante para KB)
    root_cause: incident.resolution?.root_cause || 
                incident.cline_work?.analysis?.root_cause || 
                'No especificada',
    resolution: incident.resolution?.description || 
                incident.cline_work?.solution?.description || 
                'No especificada',
    resolution_type: incident.resolution?.resolution_type,
    resolution_steps: incident.cline_work?.solution?.steps || [],
    
    // Cambios de código (si aplica)
    code_changes: incident.cline_work?.solution?.code_changes || [],
    
    // Metadatos
    resolved_by: incident.resolution?.resolved_by,
    resolved_at: incident.resolution?.resolved_at,
    resolution_time_minutes: calculateResolutionTime(incident),
    
    // Tags para búsqueda
    tags: incident.tags || [],
    
    // Timestamp de sincronización
    synced_to_kb_at: new Date().toISOString()
  };

  // Guardar en S3
  const s3Key = `${S3_PREFIX}${incident.incident_id}.json`;
  
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: JSON.stringify(kbDocument, null, 2),
    ContentType: 'application/json',
    Metadata: {
      'incident-id': incident.incident_id,
      'synced-at': new Date().toISOString(),
      'source': 'batch-sync',
      'status': 'closed'
    }
  }));

  // Actualizar estado de sincronización en DynamoDB
  await updateSyncStatus(incident.incident_id, true);
}

async function updateSyncStatus(
  incidentId: string,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  const now = new Date().toISOString();
  
  const updateExpression = success
    ? 'SET kb_sync_status = :sync_status'
    : 'SET kb_sync_status.sync_attempts = if_not_exists(kb_sync_status.sync_attempts, :zero) + :one, kb_sync_status.last_sync_attempt = :now, kb_sync_status.last_sync_error = :error';

  const expressionValues = success
    ? marshall({
        ':sync_status': {
          synced: true,
          synced_at: now,
          sync_attempts: 0
        }
      })
    : marshall({
        ':zero': 0,
        ':one': 1,
        ':now': now,
        ':error': errorMessage || 'Unknown error'
      });

  await dynamodb.send(new UpdateItemCommand({
    TableName: INCIDENTS_TABLE,
    Key: marshall({
      incident_id: incidentId,
      sk: 'METADATA'
    }),
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionValues
  }));
}

function calculateResolutionTime(incident: Incident): number | undefined {
  if (!incident.created_at || !incident.resolved_at) {
    return undefined;
  }
  
  const created = new Date(incident.created_at).getTime();
  const resolved = new Date(incident.resolved_at).getTime();
  return Math.round((resolved - created) / 1000 / 60); // minutos
}
```

## 📊 Flujo Completo

```
1. EventBridge dispara Lambda cada hora
   ↓
2. Lambda consulta DynamoDB (GSI-2)
   - Filtro: status = 'CLOSED' AND kb_sync_status.synced = false
   - Límite: 50 incidencias
   ↓
3. Para cada incidencia:
   a. Transformar a formato KB
   b. Guardar JSON en S3
   c. Actualizar kb_sync_status.synced = true
   ↓
4. Bedrock KB sincroniza desde S3 (cada 5 min)
   ↓
5. Incidencias disponibles para búsqueda
```

**Tiempo máximo**: 65 minutos (60 min + 5 min)

## 💰 Costos

### Escenario: 50 incidencias cerradas/mes

**Lambda Ejecuciones:**
- 24 ejecuciones/día × 30 días = 720 ejecuciones/mes
- Duración promedio: 5 segundos
- Memoria: 1024 MB
- Costo: **$0.0024/mes**

**DynamoDB Lecturas:**
- 720 queries × 50 items = 36,000 lecturas/mes
- Costo: **$0.009/mes**

**DynamoDB Escrituras:**
- 50 updates/mes
- Costo: **$0.00006/mes**

**S3:**
- 50 PUT requests: **$0.00027/mes**
- Storage: **$0.000006/mes**

**Total: ~$0.012/mes** (1.2 centavos)

## 🎯 Ventajas de Este Enfoque

1. ✅ **Simplicidad**: Menos componentes que DynamoDB Streams
2. ✅ **Predecible**: Ejecución programada cada hora
3. ✅ **Económico**: Costo mínimo
4. ✅ **Fácil de monitorear**: CloudWatch Logs claros
5. ✅ **Reintentable**: Si falla, se reintenta en la siguiente ejecución
6. ✅ **Escalable**: Procesa en lotes de 50

## 📈 Monitoreo

### Métricas CloudWatch

```typescript
// Métricas personalizadas que la Lambda puede emitir
await cloudwatch.putMetricData({
  Namespace: 'IncidentManagement',
  MetricData: [
    {
      MetricName: 'IncidentsSynced',
      Value: result.successfully_synced,
      Unit: 'Count'
    },
    {
      MetricName: 'SyncErrors',
      Value: result.failed,
      Unit: 'Count'
    },
    {
      MetricName: 'SyncDuration',
      Value: duration,
      Unit: 'Milliseconds'
    }
  ]
});
```

### Dashboard CloudWatch

```yaml
Dashboard:
  Widgets:
    - Type: Metric
      Properties:
        Metrics:
          - [IncidentManagement, IncidentsSynced]
          - [IncidentManagement, SyncErrors]
        Period: 3600
        Stat: Sum
        Title: Incidents Synced per Hour
    
    - Type: Log
      Properties:
        LogGroupName: /aws/lambda/incident-kb-batch-sync
        Title: Recent Sync Logs
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

### Test Automatizado

```typescript
describe('KB Batch Sync', () => {
  test('should sync closed incidents', async () => {
    // 1. Crear incidencia de test
    await createTestIncident({
      incident_id: 'TEST-SYNC-001',
      status: 'CLOSED',
      kb_sync_status: { synced: false, sync_attempts: 0 }
    });

    // 2. Ejecutar sync
    const result = await handler();

    // 3. Verificar
    expect(result.successfully_synced).toBeGreaterThan(0);
    
    // 4. Verificar en S3
    const s3Object = await s3.getObject({
      Bucket: S3_BUCKET,
      Key: 'incidents/TEST-SYNC-001.json'
    });
    expect(s3Object).toBeDefined();
    
    // 5. Verificar estado en DynamoDB
    const incident = await getIncident('TEST-SYNC-001');
    expect(incident.kb_sync_status.synced).toBe(true);
  });
});
```

## 🔄 Manejo de Errores

### Reintentos Automáticos

```typescript
// La Lambda reintentará en la siguiente ejecución
// El campo sync_attempts lleva la cuenta

// Si sync_attempts > 3, enviar alerta
if (incident.kb_sync_status?.sync_attempts > 3) {
  await sns.publish({
    TopicArn: ALERT_TOPIC_ARN,
    Subject: 'Incident sync failing repeatedly',
    Message: `Incident ${incident.incident_id} has failed ${incident.kb_sync_status.sync_attempts} times`
  });
}
```

### Dead Letter Queue (Opcional)

Si la Lambda falla completamente, EventBridge puede enviar a DLQ:

```yaml
IncidentKBBatchSyncFunction:
  Properties:
    DeadLetterQueue:
      Type: SQS
      TargetArn: !GetAtt SyncDLQ.Arn
```

## 📝 Configuración Inicial

### 1. Actualizar Tabla DynamoDB

```bash
# No requiere cambios en la tabla
# Solo añadir el campo kb_sync_status al cerrar incidencias
```

### 2. Desplegar Lambda

```bash
cd mcp-incidents-lambda
npm run build
sam deploy --guided
```

### 3. Configurar Bedrock KB

```bash
# Añadir prefijo 'incidents/' como data source en KB
aws bedrock-agent update-data-source \
  --knowledge-base-id VH6SRH9ZNO \
  --data-source-id <DATA_SOURCE_ID> \
  --data-source-configuration '{
    "type": "S3",
    "s3Configuration": {
      "bucketArn": "arn:aws:s3:::piloto-plan-pruebas-origen-datos-source",
      "inclusionPrefixes": ["incidents/"]
    }
  }'
```

## ✅ Checklist de Implementación

- [ ] Actualizar modelo de datos para incluir `kb_sync_status`
- [ ] Crear Lambda `incident-kb-batch-sync`
- [ ] Configurar EventBridge Rule (cada hora)
- [ ] Configurar permisos IAM
- [ ] Añadir prefijo `incidents/` a Bedrock KB
- [ ] Configurar alarmas CloudWatch
- [ ] Probar sincronización manual
- [ ] Monitorear primera ejecución automática
- [ ] Documentar para el equipo

## 🎯 Próximos Pasos

1. Implementar la Lambda batch
2. Probar con incidencias de test
3. Monitorear durante 1 semana
4. Si se necesita más frecuencia, cambiar a `rate(30 minutes)`
5. Si se necesita tiempo real, migrar a DynamoDB Streams (Opción 1)
