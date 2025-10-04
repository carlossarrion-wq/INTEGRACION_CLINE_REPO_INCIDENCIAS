# Estrategia de Sincronización con Knowledge Base

## 📋 Objetivo

Diseñar la estrategia óptima para sincronizar incidencias cerradas desde DynamoDB hacia la Knowledge Base de Bedrock, permitiendo que futuras búsquedas encuentren estas resoluciones.

## 🎯 Requisito

Cuando una incidencia se cierra en DynamoDB con su resolución completa, debe sincronizarse automáticamente con la Knowledge Base de Bedrock para:
1. Enriquecer la base de conocimiento con nuevas resoluciones
2. Permitir que futuros desarrolladores encuentren soluciones similares
3. Mejorar continuamente la calidad de las recomendaciones

## 🔍 Análisis de Opciones

### Opción 1: DynamoDB Streams → Lambda → S3 → Knowledge Base (RECOMENDADA)

```
DynamoDB (incidents)
    ↓ DynamoDB Streams
Lambda (Processor)
    ↓ Transforma y formatea
S3 (incident-kb-source)
    ↓ Sync automático
Bedrock Knowledge Base
```

#### Ventajas ✅
- **Automático**: Se activa cuando cambia el estado a CLOSED
- **Escalable**: DynamoDB Streams maneja alto volumen
- **Desacoplado**: S3 actúa como buffer y fuente de verdad
- **Reintentable**: Si falla, se puede reprocesar desde S3
- **Auditable**: S3 mantiene historial de documentos
- **Compatible con KB**: Bedrock KB ya está configurado para leer de S3
- **Sin cambios en KB**: Usa la infraestructura existente

#### Desventajas ❌
- Requiere configurar DynamoDB Streams
- Latencia adicional (segundos a minutos)
- Costo adicional de Lambda y S3 (mínimo)

#### Flujo Detallado

```typescript
// 1. DynamoDB Stream detecta cambio
{
  eventName: 'MODIFY',
  dynamodb: {
    NewImage: {
      incident_id: 'INC-12345',
      status: 'CLOSED',
      resolution: { ... },
      cline_work: { ... }
    },
    OldImage: {
      status: 'RESOLVED'
    }
  }
}

// 2. Lambda procesa el evento
async function processIncidentClosure(event) {
  for (const record of event.Records) {
    if (record.eventName === 'MODIFY') {
      const newImage = unmarshall(record.dynamodb.NewImage);
      const oldImage = unmarshall(record.dynamodb.OldImage);
      
      // Solo procesar si cambió a CLOSED
      if (newImage.status === 'CLOSED' && oldImage.status !== 'CLOSED') {
        await syncToKnowledgeBase(newImage);
      }
    }
  }
}

// 3. Transformar a formato KB
async function syncToKnowledgeBase(incident) {
  const kbDocument = {
    incident_id: incident.incident_id,
    title: incident.title,
    description: incident.description,
    category: incident.category,
    severity: incident.severity,
    
    // Información de resolución
    root_cause: incident.resolution.root_cause,
    resolution: incident.resolution.description,
    resolution_steps: incident.cline_work?.solution?.steps || [],
    
    // Contexto técnico
    affected_systems: incident.affected_systems,
    environment: incident.environment,
    error_message: incident.error_message,
    
    // Metadatos
    resolved_by: incident.resolution.resolved_by,
    resolved_at: incident.resolution.resolved_at,
    resolution_type: incident.resolution.resolution_type,
    
    // Para búsqueda
    tags: incident.tags,
    source_system: incident.source_system,
    external_id: incident.external_id
  };
  
  // 4. Guardar en S3
  const s3Key = `incidents/${incident.incident_id}.json`;
  await s3.putObject({
    Bucket: 'piloto-plan-pruebas-origen-datos-source',
    Key: s3Key,
    Body: JSON.stringify(kbDocument, null, 2),
    ContentType: 'application/json',
    Metadata: {
      'incident-id': incident.incident_id,
      'synced-at': new Date().toISOString(),
      'source': 'dynamodb-stream'
    }
  });
  
  // 5. Bedrock KB sincroniza automáticamente desde S3
  // (Ya configurado en la KB existente)
}
```

### Opción 2: Lambda Directa → Bedrock KB API

```
DynamoDB (incidents)
    ↓ DynamoDB Streams
Lambda (Processor)
    ↓ API Call
Bedrock Knowledge Base API
```

#### Ventajas ✅
- Sincronización inmediata
- Sin almacenamiento intermedio
- Menos componentes

#### Desventajas ❌
- **NO RECOMENDADA**: Bedrock KB no tiene API directa para ingestar documentos
- Bedrock KB requiere S3 como fuente de datos
- No hay forma de "push" documentos directamente
- Menos auditable

**Conclusión**: Esta opción NO es viable con la arquitectura actual de Bedrock KB.

### Opción 3: Batch Job Periódico → S3 → Knowledge Base

```
DynamoDB (incidents)
    ↓ EventBridge Schedule (cada hora)
Lambda (Batch Processor)
    ↓ Query incidencias cerradas no sincronizadas
S3 (incident-kb-source)
    ↓ Sync automático
Bedrock Knowledge Base
```

#### Ventajas ✅
- Simple de implementar
- Procesa en lotes (eficiente)
- Fácil de monitorear

#### Desventajas ❌
- Latencia alta (hasta 1 hora)
- Requiere flag de sincronización en DynamoDB
- Menos tiempo real

## 🏆 Recomendación: Opción 1 (DynamoDB Streams)

### Arquitectura Recomendada

```yaml
# Componentes necesarios

1. DynamoDB Table (incidents)
   - Habilitar Streams
   - Stream View Type: NEW_AND_OLD_IMAGES

2. Lambda Function (incident-kb-sync)
   - Trigger: DynamoDB Stream
   - Batch Size: 10
   - Retry: 2 intentos
   - Dead Letter Queue: SQS

3. S3 Bucket (piloto-plan-pruebas-origen-datos-source)
   - Ya existe
   - Estructura: incidents/{incident_id}.json

4. Bedrock Knowledge Base (VH6SRH9ZNO)
   - Ya configurado
   - Sync automático desde S3
```

### Implementación CloudFormation

```yaml
Resources:
  # Habilitar DynamoDB Streams
  IncidentsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: incidents
      StreamSpecification:
        StreamViewType: NEW_AND_OLD_IMAGES
      # ... resto de configuración

  # Lambda para procesar streams
  IncidentKBSyncFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: incident-kb-sync
      CodeUri: ../dist
      Handler: kb-sync.handler
      Runtime: nodejs20.x
      Timeout: 60
      MemorySize: 512
      Environment:
        Variables:
          S3_BUCKET: piloto-plan-pruebas-origen-datos-source
          S3_PREFIX: incidents/
          KB_ID: VH6SRH9ZNO
      Policies:
        - DynamoDBStreamReadPolicy:
            TableName: !Ref IncidentsTable
            StreamName: !GetAtt IncidentsTable.StreamArn
        - S3CrudPolicy:
            BucketName: piloto-plan-pruebas-origen-datos-source
      Events:
        DynamoDBStream:
          Type: DynamoDB
          Properties:
            Stream: !GetAtt IncidentsTable.StreamArn
            StartingPosition: LATEST
            BatchSize: 10
            MaximumBatchingWindowInSeconds: 5
            MaximumRetryAttempts: 2
            BisectBatchOnFunctionError: true
            DestinationConfig:
              OnFailure:
                Type: SQS
                Destination: !GetAtt SyncDLQ.Arn

  # Dead Letter Queue para errores
  SyncDLQ:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: incident-kb-sync-dlq
      MessageRetentionPeriod: 1209600  # 14 días

  # Alarma para DLQ
  SyncDLQAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: incident-kb-sync-dlq-messages
      MetricName: ApproximateNumberOfMessagesVisible
      Namespace: AWS/SQS
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 1
      ComparisonOperator: GreaterThanOrEqualToThreshold
      Dimensions:
        - Name: QueueName
          Value: !GetAtt SyncDLQ.QueueName
```

### Código Lambda (kb-sync.ts)

```typescript
import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const S3_BUCKET = process.env.S3_BUCKET!;
const S3_PREFIX = process.env.S3_PREFIX || 'incidents/';

interface Incident {
  incident_id: string;
  status: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  resolution?: {
    resolved_by: string;
    resolved_at: string;
    resolution_type: string;
    description: string;
    root_cause?: string;
  };
  cline_work?: {
    solution?: {
      description: string;
      steps: string[];
      code_changes?: Array<{
        file: string;
        description: string;
      }>;
    };
  };
  [key: string]: any;
}

export async function handler(event: DynamoDBStreamEvent) {
  console.log('Processing DynamoDB Stream event', {
    recordCount: event.Records.length
  });

  const results = await Promise.allSettled(
    event.Records.map(record => processRecord(record))
  );

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    console.error('Some records failed to process', {
      failedCount: failed.length,
      errors: failed.map(f => (f as PromiseRejectedResult).reason)
    });
    throw new Error(`Failed to process ${failed.length} records`);
  }

  console.log('Successfully processed all records');
}

async function processRecord(record: DynamoDBRecord) {
  if (record.eventName !== 'MODIFY') {
    console.log('Skipping non-MODIFY event', { eventName: record.eventName });
    return;
  }

  const newImage = unmarshall(record.dynamodb!.NewImage!) as Incident;
  const oldImage = record.dynamodb!.OldImage 
    ? unmarshall(record.dynamodb!.OldImage!) as Incident
    : null;

  // Solo procesar si cambió a CLOSED
  if (newImage.status === 'CLOSED' && oldImage?.status !== 'CLOSED') {
    console.log('Incident closed, syncing to KB', {
      incident_id: newImage.incident_id
    });
    await syncIncidentToKB(newImage);
  } else {
    console.log('Skipping - not a closure event', {
      incident_id: newImage.incident_id,
      newStatus: newImage.status,
      oldStatus: oldImage?.status
    });
  }
}

async function syncIncidentToKB(incident: Incident) {
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
    subcategory: incident.subcategory,
    severity: incident.severity,
    priority: incident.priority,
    
    // Contexto técnico
    affected_systems: incident.affected_systems || [],
    affected_services: incident.affected_services || [],
    environment: incident.environment,
    error_message: incident.error_message,
    
    // Resolución (lo más importante para KB)
    root_cause: incident.resolution?.root_cause || 
                incident.cline_work?.analysis?.root_cause,
    resolution: incident.resolution?.description,
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
      'source': 'dynamodb-stream',
      'status': 'closed'
    }
  }));

  console.log('Incident synced to S3 for KB ingestion', {
    incident_id: incident.incident_id,
    s3_key: s3Key
  });
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

## 📊 Flujo Completo de Sincronización

```
1. Desarrollador cierra incidencia desde Cline
   ↓
2. DynamoDB actualiza status = 'CLOSED'
   ↓
3. DynamoDB Stream emite evento
   ↓
4. Lambda (incident-kb-sync) se activa automáticamente
   ↓
5. Lambda transforma incidencia a formato KB
   ↓
6. Lambda guarda JSON en S3
   ↓
7. Bedrock KB detecta nuevo archivo en S3
   ↓
8. Bedrock KB ingesta y vectoriza el documento
   ↓
9. Documento disponible para búsquedas futuras
```

**Tiempo total**: 2-5 minutos desde cierre hasta disponibilidad en KB

## 💰 Costos Adicionales

### Escenario: 50 incidencias cerradas/mes

**DynamoDB Streams:**
- Incluido en el costo de DynamoDB
- Sin costo adicional

**Lambda (incident-kb-sync):**
- 50 invocaciones/mes
- ~500ms por invocación
- 512 MB memoria
- Costo: **$0.000001/mes** (prácticamente gratis)

**S3 Storage:**
- 50 documentos × 5 KB = 250 KB/mes
- Costo: **$0.000006/mes**

**S3 PUT Requests:**
- 50 requests/mes
- Costo: **$0.00027/mes**

**Total adicional: ~$0.0003/mes** (menos de 1 centavo)

## 🔧 Configuración de Bedrock KB

La Knowledge Base ya está configurada para sincronizar desde S3:

```yaml
Knowledge Base ID: VH6SRH9ZNO
Data Source: S3
Bucket: piloto-plan-pruebas-origen-datos-source
Sync Mode: Automatic (detecta nuevos archivos)
Sync Frequency: Cada 5 minutos (configurable)
```

**Acción requerida**: Añadir el prefijo `incidents/` como fuente de datos adicional en la KB.

## 🎯 Atributos Clave para la KB

Para maximizar la efectividad de las búsquedas, el documento JSON debe incluir:

### Campos Obligatorios
- `title`: Título descriptivo
- `description`: Descripción del problema
- `root_cause`: Causa raíz identificada
- `resolution`: Descripción de la solución
- `resolution_steps`: Pasos para resolver

### Campos Recomendados
- `category`: Para filtrar por tipo
- `severity`: Para priorizar resultados
- `error_message`: Para matching exacto
- `affected_systems`: Para contexto
- `tags`: Para búsqueda por keywords

### Campos Opcionales
- `code_changes`: Cambios de código realizados
- `resolution_time_minutes`: Para métricas
- `similar_incidents`: Referencias cruzadas

## 📈 Monitoreo y Alertas

### Métricas CloudWatch

```yaml
Metrics:
  - Lambda Invocations (incident-kb-sync)
  - Lambda Errors
  - Lambda Duration
  - DLQ Messages (errores)
  - S3 PutObject Success Rate
```

### Alarmas Recomendadas

```yaml
Alarms:
  - DLQ tiene mensajes (error en sincronización)
  - Lambda error rate > 5%
  - Lambda duration > 30s (timeout warning)
```

## 🧪 Testing

### Test de Sincronización

```typescript
// 1. Cerrar incidencia en DynamoDB
await dynamodb.updateItem({
  TableName: 'incidents',
  Key: { incident_id: 'TEST-001', sk: 'METADATA' },
  UpdateExpression: 'SET #status = :closed',
  ExpressionAttributeNames: { '#status': 'status' },
  ExpressionAttributeValues: { ':closed': 'CLOSED' }
});

// 2. Esperar 10 segundos
await sleep(10000);

// 3. Verificar que existe en S3
const s3Object = await s3.getObject({
  Bucket: 'piloto-plan-pruebas-origen-datos-source',
  Key: 'incidents/TEST-001.json'
});

// 4. Esperar 5 minutos para sync de KB
await sleep(300000);

// 5. Buscar en KB
const results = await bedrockKB.retrieve({
  knowledgeBaseId: 'VH6SRH9ZNO',
  retrievalQuery: { text: 'TEST-001' }
});

assert(results.retrievalResults.length > 0);
```

## 📚 Documentación Adicional

- [DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)
- [Lambda DynamoDB Triggers](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html)
- [Bedrock KB Data Sources](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-ds.html)

## ✅ Checklist de Implementación

- [ ] Habilitar DynamoDB Streams en tabla `incidents`
- [ ] Crear Lambda `incident-kb-sync`
- [ ] Configurar trigger DynamoDB Stream → Lambda
- [ ] Configurar Dead Letter Queue
- [ ] Añadir prefijo `incidents/` a Bedrock KB data sources
- [ ] Configurar alarmas CloudWatch
- [ ] Probar sincronización end-to-end
- [ ] Documentar proceso para el equipo
- [ ] Monitorear primeras sincronizaciones
