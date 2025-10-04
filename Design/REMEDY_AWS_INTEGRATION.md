# Integración BMC Remedy con AWS DynamoDB

## Resumen Ejecutivo

Este documento describe las opciones de arquitectura para integrar BMC Remedy con AWS, permitiendo la sincronización automática de incidencias asignadas a grupos de usuarios específicos hacia DynamoDB.

## Arquitectura Recomendada

```
┌─────────────────────────────────────────────────────────────────┐
│                      BMC Remedy                                  │
│                                                                  │
│  ┌──────────────────┐         ┌─────────────────────┐          │
│  │  Incident Table  │         │  Filter/Escalation  │          │
│  │  (HPD:Help Desk) │────────▶│  (Trigger on Save)  │          │
│  └──────────────────┘         └──────────┬──────────┘          │
│                                           │                      │
└───────────────────────────────────────────┼──────────────────────┘
                                            │
                                            │ REST API Call
                                            │ (Webhook)
                                            ▼
                    ┌───────────────────────────────────┐
                    │      AWS API Gateway              │
                    │  (REST API + API Key Auth)        │
                    └──────────────┬────────────────────┘
                                   │
                                   │ Invoke
                                   ▼
                    ┌───────────────────────────────────┐
                    │   Lambda: remedy-sync-handler     │
                    │                                   │
                    │  1. Validate payload              │
                    │  2. Transform Remedy → DynamoDB   │
                    │  3. Enrich with metadata          │
                    │  4. Write to DynamoDB             │
                    │  5. Publish to EventBridge        │
                    └──────────┬────────────────────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  DynamoDB    │  │ EventBridge  │  │ CloudWatch   │
    │  incidents   │  │ Event Bus    │  │ Logs/Metrics │
    └──────────────┘  └──────┬───────┘  └──────────────┘
                             │
                             │ Trigger
                             ▼
              ┌──────────────────────────────┐
              │  Lambda: incident-processor  │
              │  - Send notifications        │
              │  - Update KB sync status     │
              │  - Trigger workflows         │
              └──────────────────────────────┘
```

## Opciones de Integración

### Opción 1: Push desde Remedy (Recomendada)

**Descripción**: Remedy envía incidencias a AWS mediante webhooks cuando se crean o actualizan.

**Componentes**:
1. **Remedy Filter/Escalation**: Trigger que detecta cambios en incidencias
2. **API Gateway**: Endpoint REST público con autenticación
3. **Lambda Handler**: Procesa y almacena en DynamoDB
4. **EventBridge**: Orquesta workflows posteriores

**Ventajas**:
- ✅ Sincronización en tiempo real
- ✅ Bajo overhead en Remedy
- ✅ Escalable automáticamente
- ✅ Auditoría completa en CloudWatch

**Desventajas**:
- ❌ Requiere configuración en Remedy
- ❌ Dependencia de conectividad Remedy → AWS

**Configuración en Remedy**:
```javascript
// Filter: On Save of Incident
// Run If: 'Assigned Group' = "Your Target Group"

// Active Link: Call REST API
URL: https://api-gateway-url.execute-api.eu-west-1.amazonaws.com/prod/incidents
Method: POST
Headers: {
  "x-api-key": "your-api-key",
  "Content-Type": "application/json"
}
Body: {
  "incident_id": $Incident Number$,
  "title": $Description$,
  "status": $Status$,
  "priority": $Priority$,
  "assigned_to": $Assignee$,
  "assigned_group": $Assigned Group$,
  "category": $Categorization Tier 1$,
  "description": $Detailed Description$,
  "created_date": $Submit Date$,
  "modified_date": $Modified Date$
}
```

### Opción 2: Pull desde AWS (Polling)

**Descripción**: Lambda en AWS consulta periódicamente la API de Remedy.

**Componentes**:
1. **EventBridge Schedule**: Trigger cada X minutos
2. **Lambda Poller**: Consulta Remedy REST API
3. **DynamoDB**: Almacena incidencias y estado de sincronización
4. **Secrets Manager**: Credenciales de Remedy

**Arquitectura**:
```
┌──────────────────┐
│  EventBridge     │
│  Schedule Rule   │
│  (every 5 min)   │
└────────┬─────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Lambda: remedy-poller          │
│                                 │
│  1. Get last sync timestamp     │
│  2. Query Remedy API            │
│  3. Filter by group & timestamp │
│  4. Transform & store           │
│  5. Update sync checkpoint      │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Remedy REST API                │
│  GET /api/arsys/v1/entry/       │
│      HPD:Help Desk              │
│  ?q='Assigned Group'="MyGroup"  │
│   AND 'Modified Date' > $last$  │
└─────────────────────────────────┘
```

**Ventajas**:
- ✅ No requiere cambios en Remedy
- ✅ Control total desde AWS
- ✅ Fácil de implementar y mantener

**Desventajas**:
- ❌ Latencia de sincronización (5-15 min)
- ❌ Mayor carga en Remedy API
- ❌ Costos de Lambda por polling

### Opción 3: Híbrida (Push + Pull)

**Descripción**: Combina webhooks para eventos críticos y polling para sincronización completa.

**Casos de uso**:
- **Push**: Incidencias nuevas o cambios de estado críticos
- **Pull**: Sincronización completa cada hora para garantizar consistencia

## Implementación Detallada - Opción 1 (Push)

### 1. API Gateway Configuration

```yaml
# infrastructure/remedy-api-gateway.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  RemedyIncidentAPI:
    Type: AWS::Serverless::Api
    Properties:
      Name: remedy-incident-sync-api
      StageName: prod
      Auth:
        ApiKeyRequired: true
      Cors:
        AllowOrigin: "'*'"
        AllowHeaders: "'Content-Type,X-Api-Key'"
        AllowMethods: "'POST,OPTIONS'"
      DefinitionBody:
        openapi: 3.0.0
        info:
          title: Remedy Incident Sync API
          version: 1.0.0
        paths:
          /incidents:
            post:
              summary: Receive incident from Remedy
              security:
                - ApiKeyAuth: []
              requestBody:
                required: true
                content:
                  application/json:
                    schema:
                      $ref: '#/components/schemas/RemedyIncident'
              responses:
                '200':
                  description: Incident processed successfully
                '400':
                  description: Invalid request
                '401':
                  description: Unauthorized
        components:
          securitySchemes:
            ApiKeyAuth:
              type: apiKey
              in: header
              name: x-api-key
          schemas:
            RemedyIncident:
              type: object
              required:
                - incident_id
                - title
                - status
              properties:
                incident_id:
                  type: string
                title:
                  type: string
                status:
                  type: string
                priority:
                  type: string
                assigned_to:
                  type: string
                assigned_group:
                  type: string

  RemedyApiKey:
    Type: AWS::ApiGateway::ApiKey
    Properties:
      Name: remedy-webhook-key
      Enabled: true

  RemedyUsagePlan:
    Type: AWS::ApiGateway::UsagePlan
    Properties:
      ApiStages:
        - ApiId: !Ref RemedyIncidentAPI
          Stage: prod
      Throttle:
        BurstLimit: 100
        RateLimit: 50

  RemedyUsagePlanKey:
    Type: AWS::ApiGateway::UsagePlanKey
    Properties:
      KeyId: !Ref RemedyApiKey
      KeyType: API_KEY
      UsagePlanId: !Ref RemedyUsagePlan
```

### 2. Lambda Handler Implementation

```typescript
// src/remedy-sync-handler.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const eventBridge = new EventBridgeClient({ region: process.env.AWS_REGION });

interface RemedyIncident {
  incident_id: string;
  title: string;
  status: string;
  priority: string;
  assigned_to: string;
  assigned_group: string;
  category?: string;
  description?: string;
  created_date?: string;
  modified_date?: string;
  resolution?: string;
  resolution_date?: string;
}

interface DynamoDBIncident {
  incident_id: string;
  sk: string;
  external_id: string;
  source_system: string;
  title: string;
  description: string;
  status: 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  priority: string;
  assigned_to: string;
  team: string;
  category: string;
  created_at: string;
  updated_at: string;
  source_url?: string;
  kb_sync_status: {
    synced: boolean;
    last_attempt?: string;
    sync_attempts: number;
  };
  remedy_metadata: {
    assigned_group: string;
    original_status: string;
    last_modified: string;
  };
}

/**
 * Mapea estados de Remedy a estados internos
 */
function mapRemedyStatus(remedyStatus: string): DynamoDBIncident['status'] {
  const statusMap: Record<string, DynamoDBIncident['status']> = {
    'New': 'NEW',
    'Assigned': 'ASSIGNED',
    'In Progress': 'IN_PROGRESS',
    'Pending': 'IN_PROGRESS',
    'Resolved': 'RESOLVED',
    'Closed': 'CLOSED',
  };
  return statusMap[remedyStatus] || 'NEW';
}

/**
 * Mapea prioridades de Remedy a severidad
 */
function mapRemedyPriority(priority: string): DynamoDBIncident['severity'] {
  const priorityMap: Record<string, DynamoDBIncident['severity']> = {
    'Critical': 'CRITICAL',
    'High': 'HIGH',
    'Medium': 'MEDIUM',
    'Low': 'LOW',
  };
  return priorityMap[priority] || 'MEDIUM';
}

/**
 * Transforma incidencia de Remedy a formato DynamoDB
 */
function transformRemedyIncident(remedy: RemedyIncident): DynamoDBIncident {
  const now = new Date().toISOString();
  const status = mapRemedyStatus(remedy.status);
  const severity = mapRemedyPriority(remedy.priority);

  return {
    incident_id: `INC-REMEDY-${remedy.incident_id}`,
    sk: 'METADATA',
    external_id: remedy.incident_id,
    source_system: 'REMEDY',
    title: remedy.title,
    description: remedy.description || remedy.title,
    status,
    severity,
    priority: remedy.priority,
    assigned_to: remedy.assigned_to,
    team: remedy.assigned_group,
    category: remedy.category || 'General',
    created_at: remedy.created_date || now,
    updated_at: now,
    source_url: `https://remedy.company.com/incident/${remedy.incident_id}`,
    kb_sync_status: {
      synced: false,
      sync_attempts: 0,
    },
    remedy_metadata: {
      assigned_group: remedy.assigned_group,
      original_status: remedy.status,
      last_modified: remedy.modified_date || now,
    },
  };
}

/**
 * Publica evento a EventBridge para procesamiento posterior
 */
async function publishIncidentEvent(incident: DynamoDBIncident, action: 'created' | 'updated') {
  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: 'remedy.sync',
      DetailType: `incident.${action}`,
      Detail: JSON.stringify({
        incident_id: incident.incident_id,
        status: incident.status,
        severity: incident.severity,
        assigned_to: incident.assigned_to,
        team: incident.team,
        source_system: 'REMEDY',
      }),
      EventBusName: 'default',
    }],
  }));
}

/**
 * Handler principal
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Received Remedy webhook:', JSON.stringify(event, null, 2));

  try {
    // Validar payload
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing request body' }),
      };
    }

    const remedyIncident: RemedyIncident = JSON.parse(event.body);

    // Validar campos requeridos
    if (!remedyIncident.incident_id || !remedyIncident.title || !remedyIncident.status) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }

    // Transformar a formato DynamoDB
    const dynamoIncident = transformRemedyIncident(remedyIncident);

    // Verificar si la incidencia ya existe
    const existingIncident = await docClient.send(new GetCommand({
      TableName: process.env.INCIDENTS_TABLE_NAME!,
      Key: {
        incident_id: dynamoIncident.incident_id,
        sk: 'METADATA',
      },
    }));

    const action = existingIncident.Item ? 'updated' : 'created';

    // Si existe, preservar ciertos campos
    if (existingIncident.Item) {
      dynamoIncident.created_at = existingIncident.Item.created_at;
      dynamoIncident.kb_sync_status = existingIncident.Item.kb_sync_status || dynamoIncident.kb_sync_status;
      
      // Si cambió a CLOSED, marcar para resincronización
      if (dynamoIncident.status === 'CLOSED' && existingIncident.Item.status !== 'CLOSED') {
        dynamoIncident.kb_sync_status.synced = false;
      }
    }

    // Guardar en DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.INCIDENTS_TABLE_NAME!,
      Item: dynamoIncident,
    }));

    // Publicar evento para procesamiento posterior
    await publishIncidentEvent(dynamoIncident, action);

    console.log(`Incident ${action}:`, dynamoIncident.incident_id);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        incident_id: dynamoIncident.incident_id,
        action,
        message: `Incident ${action} successfully`,
      }),
    };

  } catch (error) {
    console.error('Error processing Remedy incident:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
```

### 3. CloudFormation Template Completo

```yaml
# infrastructure/remedy-integration-template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: BMC Remedy Integration with AWS

Parameters:
  IncidentsTableName:
    Type: String
    Default: incidents
    Description: Name of the DynamoDB incidents table

Resources:
  # API Gateway
  RemedyAPI:
    Type: AWS::Serverless::Api
    Properties:
      Name: remedy-incident-sync-api
      StageName: prod
      Auth:
        ApiKeyRequired: true
      AccessLogSetting:
        DestinationArn: !GetAtt ApiAccessLogs.Arn
        Format: '$context.requestId $context.error.message $context.error.messageString'

  # Lambda Function
  RemedySyncFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: remedy-sync-handler
      Runtime: nodejs20.x
      Handler: remedy-sync-handler.handler
      CodeUri: ../dist/
      Timeout: 30
      MemorySize: 512
      Environment:
        Variables:
          INCIDENTS_TABLE_NAME: !Ref IncidentsTableName
          AWS_REGION: !Ref AWS::Region
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref IncidentsTableName
        - EventBridgePutEventsPolicy:
            EventBusName: default
      Events:
        RemedyWebhook:
          Type: Api
          Properties:
            RestApiId: !Ref RemedyAPI
            Path: /incidents
            Method: POST

  # API Key
  RemedyApiKey:
    Type: AWS::ApiGateway::ApiKey
    Properties:
      Name: remedy-webhook-key
      Enabled: true

  # Usage Plan
  RemedyUsagePlan:
    Type: AWS::ApiGateway::UsagePlan
    Properties:
      ApiStages:
        - ApiId: !Ref RemedyAPI
          Stage: prod
      Throttle:
        BurstLimit: 100
        RateLimit: 50
      Quota:
        Limit: 10000
        Period: DAY

  RemedyUsagePlanKey:
    Type: AWS::ApiGateway::UsagePlanKey
    Properties:
      KeyId: !Ref RemedyApiKey
      KeyType: API_KEY
      UsagePlanId: !Ref RemedyUsagePlan

  # CloudWatch Logs
  ApiAccessLogs:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: /aws/apigateway/remedy-sync
      RetentionInDays: 30

  # CloudWatch Alarms
  RemedySyncErrorAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: remedy-sync-errors
      AlarmDescription: Alert when Remedy sync has errors
      MetricName: Errors
      Namespace: AWS/Lambda
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 5
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: FunctionName
          Value: !Ref RemedySyncFunction

Outputs:
  ApiEndpoint:
    Description: API Gateway endpoint URL
    Value: !Sub 'https://${RemedyAPI}.execute-api.${AWS::Region}.amazonaws.com/prod/incidents'
  
  ApiKeyId:
    Description: API Key ID (retrieve value from console)
    Value: !Ref RemedyApiKey
```

### 4. Script de Deployment

```bash
#!/bin/bash
# infrastructure/deploy-remedy-integration.sh

set -e

echo "🚀 Deploying Remedy Integration..."

# Variables
STACK_NAME="remedy-integration"
INCIDENTS_TABLE="incidents"
REGION="eu-west-1"

# Build TypeScript
echo "📦 Building TypeScript..."
cd ..
npm run build

# Deploy with SAM
echo "☁️  Deploying to AWS..."
cd infrastructure
sam deploy \
  --template-file remedy-integration-template.yaml \
  --stack-name $STACK_NAME \
  --parameter-overrides \
    "IncidentsTableName=$INCIDENTS_TABLE" \
  --capabilities CAPABILITY_IAM \
  --region $REGION \
  --no-fail-on-empty-changeset

# Get outputs
echo "📋 Getting deployment outputs..."
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

API_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiKeyId`].OutputValue' \
  --output text)

# Get API Key value
API_KEY=$(aws apigateway get-api-key \
  --api-key $API_KEY_ID \
  --include-value \
  --region $REGION \
  --query 'value' \
  --output text)

echo ""
echo "✅ Deployment completed!"
echo ""
echo "📝 Configuration for Remedy:"
echo "  API Endpoint: $API_ENDPOINT"
echo "  API Key: $API_KEY"
echo ""
echo "🔧 Configure Remedy Filter/Active Link with these values"
```

## Configuración en BMC Remedy

### Filter Configuration

```
Filter Name: AWS_Incident_Sync
Form: HPD:Help Desk
Execute On: Submit, Modify
Run If: ('Assigned Group' = "Your Target Group") AND 
        ('Status' != "Cancelled")

Action: Run Process
  Type: Active Link
  Name: AWS_Sync_Active_Link
```

### Active Link Configuration

```
Active Link Name: AWS_Sync_Active_Link
Form: HPD:Help Desk
Execute On: Display

Actions:
1. Set Fields:
   - Temp.API_URL = "https://your-api-endpoint/prod/incidents"
   - Temp.API_Key = "your-api-key"
   - Temp.Payload = JSON payload (see below)

2. Call REST API:
   - URL: $Temp.API_URL$
   - Method: POST
   - Headers:
     * x-api-key: $Temp.API_Key$
     * Content-Type: application/json
   - Body: $Temp.Payload$
   - Response Field: Temp.API_Response

3. If API call fails:
   - Log error to Remedy log
   - Send notification to admin
```

### JSON Payload Template

```json
{
  "incident_id": "$Incident Number$",
  "title": "$Description$",
  "status": "$Status$",
  "priority": "$Priority$",
  "assigned_to": "$Assignee$",
  "assigned_group": "$Assigned Group$",
  "category": "$Categorization Tier 1$",
  "description": "$Detailed Description$",
  "created_date": "$Submit Date$",
  "modified_date": "$Modified Date$",
  "resolution": "$Resolution$",
  "resolution_date": "$Resolved Date$"
}
```

## Testing

### 1. Test API Gateway Endpoint

```bash
# Test with curl
curl -X POST \
  https://your-api-endpoint/prod/incidents \
  -H 'x-api-key: your-api-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "incident_id": "INC000001234567",
    "title": "Test incident from Remedy",
    "status": "Assigned",
    "priority": "High",
    "assigned_to": "john.doe@company.com",
    "assigned_group": "Application Support",
    "category": "Application",
    "description": "Test incident for AWS integration",
    "created_date": "2025-10-04T10:00:00Z",
    "modified_date": "2025-10-04T10:00:00Z"
  }'
```

### 2. Verify in DynamoDB

```bash
aws dynamodb get-item \
  --table-name incidents \
  --key '{"incident_id": {"S": "INC-REMEDY-INC000001234567"}, "sk": {"S": "METADATA"}}'
```

### 3. Check CloudWatch Logs

```bash
aws logs tail /aws/lambda/remedy-sync-handler --follow
```

## Monitoreo y Alertas

### CloudWatch Metrics

- `RemedySyncInvocations`: Número de llamadas recibidas
- `RemedySyncErrors`: Errores en procesamiento
- `RemedySyncDuration`: Tiempo de procesamiento
- `APIGateway4XXError`: Errores de cliente (400-499)
- `APIGateway5XXError`: Errores de servidor (500-599)

### CloudWatch Alarms

1. **High Error Rate**: > 5 errores en 5 minutos
2. **API Throttling**: Rate limit excedido
3. **Lambda Timeout**: Función excede timeout
4. **DynamoDB Throttling**: Capacidad excedida

## Seguridad

### 1. API Key Rotation

```bash
# Crear nueva API key
aws apigateway create-api-key \
  --name remedy-webhook-key-v2 \
  --enabled

# Asociar a usage plan
aws apigateway create-usage-plan-key \
  --usage-plan-id <plan-id> \
  --key-id <new-key-id> \
  --key-type API_KEY

# Actualizar en Remedy
# Eliminar key antigua después de verificar
```

### 2. IP Whitelisting (Opcional)

```yaml
# Añadir resource policy a API Gateway
ResourcePolicy:
  Version: '2012-10-17'
  Statement:
    - Effect: Allow
      Principal: '*'
      Action: 'execute-api:Invoke'
      Resource: '*'
      Condition:
        IpAddress:
          aws:SourceIp:
            - '10.0.0.0/8'  # Remedy network
```

### 3. Encryption

- API Gateway: TLS 1.2+
- DynamoDB: Encryption at rest enabled
- CloudWatch Logs: Encrypted with KMS

## Costos Estimados

### Por 1000 incidencias/día

- **API Gateway**: $3.50/mes (1M requests)
- **Lambda**: $0.20/mes (1M invocations, 512MB, 1s avg)
- **DynamoDB**: $1.25/mes (write capacity)
- **CloudWatch**: $0.50/mes (logs)
- **EventBridge**: $1.00/mes (events)

**Total**: ~$6.50/mes

## Troubleshooting

### Problema: Remedy no puede conectar a API Gateway

**Solución**:
1. Verificar firewall/proxy en Remedy
2. Verificar DNS resolution
3. Verificar certificado SSL
4. Revisar logs de Remedy

### Problema: API retorna 401 Unauthorized

**Solución**:
1. Verificar API key en header
2. Verificar key está asociada a usage plan
3. Verificar key no está expirada

### Problema: Incidencias no aparecen en DynamoDB

**Solución**:
1. Revisar CloudWatch Logs de Lambda
2. Verificar permisos IAM
3. Verificar formato de payload
4. Verificar tabla DynamoDB existe

## Próximos Pasos

1. ✅ Implementar API Gateway + Lambda
2. ✅ Configurar Remedy Filter/Active Link
3. ⏳ Probar con incidencias reales
4. ⏳ Configurar monitoreo y alertas
5. ⏳ Documentar procedimientos operativos
6. ⏳ Implementar sincronización bidireccional (opcional)

## Referencias

- [BMC Remedy REST API Documentation](https://docs.bmc.com/docs/ars2002/rest-api-overview-969834815.html)
- [AWS API Gateway Best Practices](https://docs.aws.amazon.com/apigateway/latest/developerguide/best-practices.html)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
