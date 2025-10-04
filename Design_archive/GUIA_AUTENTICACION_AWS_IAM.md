# GUÍA DE IMPLEMENTACIÓN: AUTENTICACIÓN AWS IAM PARA MCP SERVER

## CONTEXTO

Esta guía detalla cómo implementar autenticación AWS IAM para el servidor MCP de análisis de incidencias, aprovechando que los usuarios ya tienen acceso a otros servicios AWS.

---

## VENTAJAS DE AWS IAM PARA ESTE CASO

✅ **Reutilización de Identidades**: Los usuarios ya tienen credenciales AWS
✅ **Gestión Centralizada**: IAM policies controlan acceso a todos los servicios
✅ **Sin Credenciales Adicionales**: No necesitas gestionar API keys separadas
✅ **Auditoría Integrada**: CloudTrail registra todas las operaciones
✅ **Roles y Permisos Granulares**: Control fino por usuario/grupo
✅ **Rotación Automática**: Credenciales temporales con STS
✅ **MFA Soportado**: Autenticación multi-factor nativa

---

## ARQUITECTURA CON AWS IAM

```
┌─────────────────────────────────────────────────────────┐
│                 Desarrollador (Usuario AWS)              │
│  ┌────────────────────────────────────────────────────┐ │
│  │  AWS Credentials:                                   │ │
│  │  - Access Key ID                                    │ │
│  │  - Secret Access Key                                │ │
│  │  - Session Token (opcional, con STS)               │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────┼───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              MCP Server Local (Node.js)                  │
│  ┌────────────────────────────────────────────────────┐ │
│  │  AWS SDK v3                                         │ │
│  │  - Firma requests con SigV4                         │ │
│  │  - Usa credenciales del usuario                     │ │
│  │  - Añade headers de autenticación                   │ │
│  └──────────────────────┬─────────────────────────────┘ │
└─────────────────────────┼───────────────────────────────┘
                          │ HTTPS + AWS SigV4
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    AWS API Gateway                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Authorizer: AWS_IAM                                │ │
│  │  - Valida firma SigV4                               │ │
│  │  - Extrae identidad del usuario                     │ │
│  │  - Verifica permisos IAM                            │ │
│  └──────────────────────┬─────────────────────────────┘ │
└─────────────────────────┼───────────────────────────────┘
                          │ event.requestContext.identity
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   Lambda Functions                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Recibe:                                            │ │
│  │  - userId (ARN del usuario)                         │ │
│  │  - accountId                                        │ │
│  │  - Permisos ya validados por API Gateway           │ │
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

---

## CONFIGURACIÓN PASO A PASO

### 1. CONFIGURAR API GATEWAY CON AUTORIZACIÓN IAM

**Terraform/CloudFormation:**
```hcl
resource "aws_api_gateway_rest_api" "incident_api" {
  name        = "incident-analysis-api"
  description = "API for incident analysis with IAM auth"
}

resource "aws_api_gateway_method" "search_incidents" {
  rest_api_id   = aws_api_gateway_rest_api.incident_api.id
  resource_id   = aws_api_gateway_resource.incidents.id
  http_method   = "POST"
  authorization = "AWS_IAM"  # ← Clave: Autorización IAM
}

resource "aws_api_gateway_deployment" "prod" {
  rest_api_id = aws_api_gateway_rest_api.incident_api.id
  stage_name  = "prod"
}
```

**AWS CLI:**
```bash
# Crear API Gateway
aws apigateway create-rest-api \
  --name incident-analysis-api \
  --description "API for incident analysis"

# Configurar método con autorización IAM
aws apigateway put-method \
  --rest-api-id <api-id> \
  --resource-id <resource-id> \
  --http-method POST \
  --authorization-type AWS_IAM
```

---

### 2. CREAR IAM POLICIES PARA USUARIOS

**Policy para Acceso Completo:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "IncidentAnalysisFullAccess",
      "Effect": "Allow",
      "Action": [
        "execute-api:Invoke"
      ],
      "Resource": [
        "arn:aws:execute-api:eu-west-1:123456789012:abc123xyz/prod/POST/incidents/search",
        "arn:aws:execute-api:eu-west-1:123456789012:abc123xyz/prod/GET/incidents/*",
        "arn:aws:execute-api:eu-west-1:123456789012:abc123xyz/prod/POST/incidents/context/download",
        "arn:aws:execute-api:eu-west-1:123456789012:abc123xyz/prod/POST/incidents/resolution",
        "arn:aws:execute-api:eu-west-1:123456789012:abc123xyz/prod/POST/incidents/patterns"
      ]
    }
  ]
}
```

**Policy para Solo Lectura:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "IncidentAnalysisReadOnly",
      "Effect": "Allow",
      "Action": [
        "execute-api:Invoke"
      ],
      "Resource": [
        "arn:aws:execute-api:eu-west-1:123456789012:abc123xyz/prod/POST/incidents/search",
        "arn:aws:execute-api:eu-west-1:123456789012:abc123xyz/prod/GET/incidents/*",
        "arn:aws:execute-api:eu-west-1:123456789012:abc123xyz/prod/POST/incidents/context/download"
      ]
    },
    {
      "Sid": "DenyWriteOperations",
      "Effect": "Deny",
      "Action": [
        "execute-api:Invoke"
      ],
      "Resource": [
        "arn:aws:execute-api:eu-west-1:123456789012:abc123xyz/prod/POST/incidents/resolution"
      ]
    }
  ]
}
```

**Policy con Condiciones (Ejemplo: Solo desde VPN):**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "IncidentAnalysisFromVPN",
      "Effect": "Allow",
      "Action": [
        "execute-api:Invoke"
      ],
      "Resource": "arn:aws:execute-api:eu-west-1:123456789012:abc123xyz/prod/*/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": [
            "10.0.0.0/8",
            "192.168.1.0/24"
          ]
        }
      }
    }
  ]
}
```

---

### 3. CREAR GRUPOS IAM POR ROL

```bash
# Grupo para Desarrolladores (acceso completo)
aws iam create-group --group-name IncidentAnalysisDevelopers

aws iam put-group-policy \
  --group-name IncidentAnalysisDevelopers \
  --policy-name IncidentAnalysisFullAccess \
  --policy-document file://policy-full-access.json

# Grupo para Analistas (solo lectura)
aws iam create-group --group-name IncidentAnalysisAnalysts

aws iam put-group-policy \
  --group-name IncidentAnalysisAnalysts \
  --policy-name IncidentAnalysisReadOnly \
  --policy-document file://policy-read-only.json

# Añadir usuarios a grupos
aws iam add-user-to-group \
  --user-name juan.perez \
  --group-name IncidentAnalysisDevelopers
```

---

### 4. IMPLEMENTAR MCP SERVER CON AWS SDK

**package.json:**
```json
{
  "name": "mcp-incident-server",
  "version": "1.0.0",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0",
    "@aws-sdk/client-apigatewaymanagementapi": "^3.x",
    "@aws-sdk/signature-v4": "^3.x",
    "@aws-sdk/protocol-http": "^3.x",
    "@aws-sdk/credential-provider-node": "^3.x",
    "axios": "^1.6.0"
  }
}
```

**src/services/aws-api-client.ts:**
```typescript
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Sha256 } from '@aws-crypto/sha256-js';
import axios from 'axios';

export class AWSAPIClient {
  private credentials: any;
  private region: string;
  private apiUrl: string;

  constructor(apiUrl: string, region: string = 'eu-west-1') {
    this.apiUrl = apiUrl;
    this.region = region;
    // Usa las credenciales del usuario (de ~/.aws/credentials o variables de entorno)
    this.credentials = defaultProvider();
  }

  /**
   * Firma una request con AWS Signature V4
   */
  private async signRequest(
    method: string,
    path: string,
    body?: any
  ): Promise<HttpRequest> {
    const url = new URL(path, this.apiUrl);
    
    const request = new HttpRequest({
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Host': url.hostname
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const signer = new SignatureV4({
      credentials: this.credentials,
      region: this.region,
      service: 'execute-api',
      sha256: Sha256
    });

    return await signer.sign(request);
  }

  /**
   * Realiza una request autenticada con IAM
   */
  async request(
    method: string,
    path: string,
    body?: any
  ): Promise<any> {
    const signedRequest = await this.signRequest(method, path, body);

    const response = await axios({
      method: signedRequest.method,
      url: `${signedRequest.protocol}//${signedRequest.hostname}${signedRequest.path}`,
      headers: signedRequest.headers,
      data: signedRequest.body
    });

    return response.data;
  }

  // Métodos específicos para cada endpoint
  async searchIncidents(query: string, filters?: any) {
    return this.request('POST', '/incidents/search', {
      query,
      filters
    });
  }

  async getIncidentDetails(incidentId: string) {
    return this.request('GET', `/incidents/${incidentId}`);
  }

  async downloadContext(incidentIds: string[]) {
    return this.request('POST', '/incidents/context/download', {
      incident_ids: incidentIds
    });
  }

  async reportResolution(data: any) {
    return this.request('POST', '/incidents/resolution', data);
  }

  async findPatterns(incidentIds: string[]) {
    return this.request('POST', '/incidents/patterns', {
      incident_ids: incidentIds
    });
  }
}
```

**src/tools/search-incidents.ts:**
```typescript
import { AWSAPIClient } from '../services/aws-api-client';

export async function searchIncidents(params: {
  query: string;
  search_type?: string;
  filters?: any;
  limit?: number;
}) {
  const client = new AWSAPIClient(
    process.env.API_GATEWAY_URL!,
    process.env.AWS_REGION
  );

  try {
    const results = await client.searchIncidents(
      params.query,
      params.filters
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2)
        }
      ]
    };
  } catch (error: any) {
    if (error.response?.status === 403) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No tienes permisos para buscar incidencias. Contacta con tu administrador AWS.'
          }
        ],
        isError: true
      };
    }
    throw error;
  }
}
```

---

### 5. CONFIGURACIÓN DEL MCP SERVER

**cline_mcp_settings.json:**
```json
{
  "mcpServers": {
    "incident-analyzer": {
      "command": "node",
      "args": ["/path/to/mcp-incident-server/dist/index.js"],
      "env": {
        "AWS_REGION": "eu-west-1",
        "API_GATEWAY_URL": "https://abc123xyz.execute-api.eu-west-1.amazonaws.com/prod",
        "AWS_PROFILE": "default"
      }
    }
  }
}
```

**Nota**: El MCP Server usará automáticamente las credenciales AWS del usuario desde:
1. Variables de entorno (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
2. Archivo `~/.aws/credentials` (perfil especificado en `AWS_PROFILE`)
3. IAM role si se ejecuta en EC2/ECS
4. AWS SSO

---

### 6. IMPLEMENTAR LAMBDA CON CONTEXTO IAM

**Lambda Handler:**
```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // API Gateway ya validó la autenticación IAM
  // Extraer información del usuario
  const userArn = event.requestContext.identity.userArn;
  const accountId = event.requestContext.accountId;
  const sourceIp = event.requestContext.identity.sourceIp;

  // Parsear ARN para obtener username
  // arn:aws:iam::123456789012:user/juan.perez
  const username = userArn?.split('/').pop() || 'unknown';

  console.log('Request from user:', {
    username,
    userArn,
    accountId,
    sourceIp,
    path: event.path,
    method: event.httpMethod
  });

  // Validaciones adicionales (opcional)
  if (!isAuthorizedForOperation(userArn, event.path, event.httpMethod)) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        error: 'Forbidden',
        message: 'No tienes permisos para esta operación'
      })
    };
  }

  // Procesar request
  try {
    const result = await processRequest(event, username);
    
    // Auditoría
    await logAuditEvent({
      userId: username,
      userArn,
      action: `${event.httpMethod} ${event.path}`,
      timestamp: new Date().toISOString(),
      sourceIp,
      success: true
    });

    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };
  } catch (error: any) {
    // Auditoría de error
    await logAuditEvent({
      userId: username,
      userArn,
      action: `${event.httpMethod} ${event.path}`,
      timestamp: new Date().toISOString(),
      sourceIp,
      success: false,
      error: error.message
    });

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      })
    };
  }
};

function isAuthorizedForOperation(
  userArn: string | undefined,
  path: string,
  method: string
): boolean {
  // Validaciones adicionales basadas en el usuario
  // Por ejemplo, solo ciertos usuarios pueden reportar resoluciones
  
  if (path === '/incidents/resolution' && method === 'POST') {
    // Verificar si el usuario está en el grupo de desarrolladores
    // Esto es redundante con IAM policies, pero añade una capa extra
    return userArn?.includes(':user/') || false;
  }

  return true;
}

async function logAuditEvent(event: any) {
  // Guardar en DynamoDB o CloudWatch Logs
  console.log('AUDIT:', JSON.stringify(event));
}
```

---

### 7. CONFIGURAR CLOUDTRAIL PARA AUDITORÍA

```bash
# Crear trail para auditar API Gateway
aws cloudtrail create-trail \
  --name incident-api-trail \
  --s3-bucket-name my-cloudtrail-bucket

aws cloudtrail start-logging \
  --name incident-api-trail

# Configurar event selectors para API Gateway
aws cloudtrail put-event-selectors \
  --trail-name incident-api-trail \
  --event-selectors '[
    {
      "ReadWriteType": "All",
      "IncludeManagementEvents": true,
      "DataResources": [
        {
          "Type": "AWS::ApiGateway::Stage",
          "Values": ["arn:aws:apigateway:eu-west-1::/restapis/*/stages/prod"]
        }
      ]
    }
  ]'
```

---

### 8. TESTING DE AUTENTICACIÓN

**Test Manual con AWS CLI:**
```bash
# Configurar credenciales
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

# Test con awscurl (herramienta que firma requests)
pip install awscurl

awscurl --service execute-api \
  --region eu-west-1 \
  -X POST \
  -d '{"query": "timeout en API"}' \
  https://abc123xyz.execute-api.eu-west-1.amazonaws.com/prod/incidents/search
```

**Test desde MCP Server:**
```typescript
// test/auth-test.ts
import { AWSAPIClient } from '../src/services/aws-api-client';

async function testAuth() {
  const client = new AWSAPIClient(
    'https://abc123xyz.execute-api.eu-west-1.amazonaws.com/prod',
    'eu-west-1'
  );

  try {
    console.log('Testing search_incidents...');
    const results = await client.searchIncidents('timeout');
    console.log('✅ Success:', results);
  } catch (error: any) {
    if (error.response?.status === 403) {
      console.error('❌ Forbidden: Check IAM permissions');
    } else {
      console.error('❌ Error:', error.message);
    }
  }
}

testAuth();
```

---

## GESTIÓN DE CREDENCIALES

### Opción 1: AWS CLI Profiles

```bash
# ~/.aws/credentials
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

[incident-dev]
aws_access_key_id = AKIAI44QH8DHBEXAMPLE
aws_secret_access_key = je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY

# Usar perfil específico
export AWS_PROFILE=incident-dev
```

### Opción 2: AWS SSO (Recomendado)

```bash
# Configurar SSO
aws configure sso

# Login
aws sso login --profile incident-sso

# El MCP Server usará automáticamente las credenciales SSO
```

### Opción 3: Credenciales Temporales con STS

```typescript
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

async function getTemporaryCredentials() {
  const sts = new STSClient({ region: 'eu-west-1' });
  
  const command = new AssumeRoleCommand({
    RoleArn: 'arn:aws:iam::123456789012:role/IncidentAnalysisRole',
    RoleSessionName: 'mcp-session',
    DurationSeconds: 3600 // 1 hora
  });

  const response = await sts.send(command);
  
  return {
    accessKeyId: response.Credentials!.AccessKeyId!,
    secretAccessKey: response.Credentials!.SecretAccessKey!,
    sessionToken: response.Credentials!.SessionToken!
  };
}
```

---

## MONITORIZACIÓN Y ALERTAS

### CloudWatch Metrics

```typescript
// Publicar métricas personalizadas
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

async function publishMetric(metricName: string, value: number, username: string) {
  const cloudwatch = new CloudWatchClient({ region: 'eu-west-1' });
  
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: 'IncidentAnalysis/MCP',
    MetricData: [
      {
        MetricName: metricName,
        Value: value,
        Unit: 'Count',
        Timestamp: new Date(),
        Dimensions: [
          {
            Name: 'User',
            Value: username
          }
        ]
      }
    ]
  }));
}
```

### CloudWatch Alarms

```bash
# Alerta si hay muchos errores 403 (permisos)
aws cloudwatch put-metric-alarm \
  --alarm-name incident-api-forbidden-errors \
  --alarm-description "Alert on high 403 errors" \
  --metric-name 4XXError \
  --namespace AWS/ApiGateway \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

---

## TROUBLESHOOTING

### Error: "User is not authorized to perform: execute-api:Invoke"

**Causa**: El usuario no tiene la IAM policy correcta

**Solución**:
```bash
# Verificar policies del usuario
aws iam list-attached-user-policies --user-name juan.perez

# Verificar grupos del usuario
aws iam list-groups-for-user --user-name juan.perez

# Añadir policy
aws iam attach-user-policy \
  --user-name juan.perez \
  --policy-arn arn:aws:iam::123456789012:policy/IncidentAnalysisFullAccess
```

### Error: "The security token included in the request is invalid"

**Causa**: Credenciales expiradas o inválidas

**Solución**:
```bash
# Verificar credenciales
aws sts get-caller-identity

# Renovar credenciales SSO
aws sso login --profile incident-sso

# O generar nuevas access keys
aws iam create-access-key --user-name juan.perez
```

### Error: "Signature expired"

**Causa**: Reloj del sistema desincronizado

**Solución**:
```bash
# Sincronizar reloj (macOS)
sudo sntp -sS time.apple.com

# Sincronizar reloj (Linux)
sudo ntpdate -s time.nist.gov
```

---

## MEJORES PRÁCTICAS

### 1. Usar Roles en lugar de Users cuando sea posible

```hcl
# Terraform: Crear role para desarrolladores
resource "aws_iam_role" "incident_developer" {
  name = "IncidentAnalysisDeveloper"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::123456789012:root"
        }
      }
    ]
  })
}

# Los usuarios asumen el role temporalmente
aws sts assume-role \
  --role-arn arn:aws:iam::123456789012:role/IncidentAnalysisDeveloper \
  --role-session-name juan-session
```

### 2. Implementar MFA para operaciones sensibles

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RequireMFAForResolution",
      "Effect": "Allow",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:*:*:*/*/POST/incidents/resolution",
      "Condition": {
        "Bool": {
          "aws:MultiFactorAuthPresent": "true"
        }
      }
    }
  ]
}
```

### 3. Rotar Credenciales Regularmente

```bash
# Script para rotar access keys
#!/bin/bash
USER_NAME="juan.perez"

# Crear nueva key
NEW_KEY=$(aws iam create-access-key --user-name $USER_NAME)
NEW_ACCESS_KEY_ID=$(echo $NEW_KEY | jq -r '.AccessKey.AccessKeyId')
NEW_SECRET_KEY=$(echo $NEW_KEY | jq -r '.AccessKey.SecretAccessKey')

# Actualizar ~/.aws/credentials
aws configure set aws_access_key_id $NEW_ACCESS_KEY_ID
aws configure set aws_secret_access_key $NEW_SECRET_KEY

# Esperar propagación
sleep 10

# Eliminar key antigua
OLD_KEY_ID=$(aws iam list-access-keys --user-name $USER_NAME | jq -r '.AccessKeyMetadata[0].AccessKeyId')
aws iam delete-access-key --user-name $USER_NAME --access-key-id $OLD_KEY_ID
```

### 4. Usar Least Privilege Principle

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MinimalPermissions",
      "Effect": "Allow",
      "Action": "execute-api:Invoke",
      "Resource": [
        "arn:aws:execute-api:eu-west-1:123456789012:abc123xyz/prod/POST/incidents/search"
      ],
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": "10.0.0.0/8"
        },
        "DateGreaterThan": {
          "aws:CurrentTime": "2025-01-01T00:00:00Z"
        },
        "DateLessThan": {
          "aws:CurrentTime": "2025-12-31T23:59:59Z"
        }
      }
    }
  ]
}
```

---

## RESUMEN

La autenticación AWS IAM para el servidor MCP ofrece:

✅ **Integración Nativa**: Usa credenciales AWS existentes
✅ **Seguridad Robusta**: Firma SigV4, MFA, roles temporales
✅ **Auditoría Completa**: CloudTrail registra todo
✅ **Gestión Centralizada**: IAM policies controlan acceso
✅ **Sin Overhead**: No necesitas gestionar API keys adicionales

**Próximos Pasos:**
1. Configurar API Gateway con autorización IAM
2. Crear IAM policies y grupos
3. Implementar MCP Server con AWS SDK
4. Configurar CloudTrail para auditoría
5. Probar con usuarios reales
