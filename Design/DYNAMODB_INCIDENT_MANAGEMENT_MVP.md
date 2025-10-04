# Diseño MVP del Módulo de Gestión de Incidencias en DynamoDB

## 📋 Objetivo MVP

Diseñar e implementar un módulo DynamoDB simplificado para:
1. ✅ **Importar incidencias** desde Jira/Remedy/ServiceNow
2. ✅ **Buscar incidencias** asignadas o disponibles desde Cline
3. ✅ **Actualizar progreso** mientras se trabaja
4. ✅ **Registrar solución** con pasos y código
5. ✅ **Cerrar incidencia** con resolución completa

## 🚫 Fuera del Alcance MVP

- ❌ Sincronización bidireccional automática
- ❌ Detección de conflictos
- ❌ Reclamar incidencias (se asignan desde el sistema origen)
- ❌ Métricas y reporting avanzado
- ❌ Dashboard

## 🗄️ Diseño Simplificado de Tabla DynamoDB

### Tabla Única: `incidents`

#### Estructura de Claves

```
Partition Key (PK): incident_id (String)
Sort Key (SK): METADATA (String constante)
```

**Justificación del diseño simplificado:**
- **PK = incident_id**: Identificador único (ej: "JIRA-12345", "INC0012345")
- **SK = "METADATA"**: Constante para permitir extensión futura con sort keys adicionales
- Sin versionado en MVP (se puede añadir después)
- Diseño simple para acceso directo por ID

#### Atributos Esenciales

```typescript
interface Incident {
  // Claves primarias
  incident_id: string;                // PK: ID único (JIRA-12345, INC0012345)
  sk: string;                         // SK: "METADATA" (constante)
  
  // Identificación del sistema origen
  external_id: string;                // ID en el sistema origen
  source_system: 'JIRA' | 'REMEDY' | 'SERVICENOW';
  source_url?: string;                // URL al ticket original
  
  // Información básica
  title: string;
  description: string;
  category: string;                   // 'Infrastructure', 'Application', 'Network'
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  
  // Estado y asignación
  status: 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  assigned_to?: string;               // Email del desarrollador asignado
  team?: string;                      // Equipo responsable
  
  // Fechas
  created_at: string;                 // ISO 8601
  updated_at: string;                 // ISO 8601
  due_date?: string;                  // Fecha límite
  resolved_at?: string;               // Fecha de resolución
  
  // Información técnica básica
  affected_systems?: string[];
  environment?: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT';
  error_message?: string;             // Mensaje de error principal
  
  // Trabajo realizado desde Cline
  cline_work?: {
    started_at: string;
    last_updated: string;
    developer: string;
    
    // Análisis (opcional)
    analysis?: {
      root_cause?: string;
      diagnosis?: string;
      similar_incidents_count?: number;
    };
    
    // Solución
    solution?: {
      description: string;
      steps: string[];
      code_changes?: Array<{
        file: string;
        description: string;
      }>;
    };
  };
  
  // Resolución
  resolution?: {
    resolved_by: string;
    resolved_at: string;
    resolution_type: 'FIXED' | 'WORKAROUND' | 'NOT_REPRODUCIBLE';
    description: string;
    root_cause?: string;
  };
  
  // Sincronización (simple)
  last_sync_at: string;               // Última sincronización desde origen
  
  // Tags simples
  tags?: string[];
}
```

#### Índices Secundarios Globales (GSI) - Mínimos Necesarios

**GSI-1: Búsqueda por Asignado**
```
PK: assigned_to (String)
SK: status#priority#created_at (String)
Projection: ALL
```
Uso: Buscar incidencias asignadas a un desarrollador

**GSI-2: Búsqueda por Estado**
```
PK: status (String)
SK: priority#created_at (String)
Projection: ALL
```
Uso: Listar incidencias por estado (NEW, IN_PROGRESS, etc.)

**GSI-3: Búsqueda por Sistema Origen (para sincronización)**
```
PK: source_system#external_id (String)
SK: sk (String)
Projection: KEYS_ONLY
```
Uso: Verificar si una incidencia ya existe al importar

## 🔧 Configuración DynamoDB Simplificada

### Capacidad
- **Modo**: On-Demand (sin planificación de capacidad)
- Ideal para MVP con carga impredecible

### Backup
- **PITR**: Habilitado (recuperación point-in-time)
- **Backups automáticos**: Diarios con retención de 7 días

### Encriptación
- **At rest**: AWS managed keys (por defecto)
- **In transit**: TLS 1.2+

### Sin TTL
- Mantener todas las incidencias indefinidamente
- Se puede añadir archivado manual después

## 📊 Patrones de Acceso MVP

### 1. Importar Incidencia desde Jira

```typescript
// 1. Verificar si ya existe
const existingKey = `${sourceSystem}#${externalId}`;
const existing = await dynamodb.query({
  TableName: 'incidents',
  IndexName: 'GSI-3-source-external',
  KeyConditionExpression: 'source_system_external_id = :key',
  ExpressionAttributeValues: {
    ':key': existingKey
  }
});

// 2. Si no existe, crear
if (existing.Items.length === 0) {
  const incidentId = `INC-${Date.now()}-${randomString(6)}`;
  
  await dynamodb.putItem({
    TableName: 'incidents',
    Item: {
      incident_id: incidentId,
      sk: 'METADATA',
      external_id: 'JIRA-12345',
      source_system: 'JIRA',
      source_url: 'https://jira.company.com/browse/JIRA-12345',
      title: 'Database connection timeout',
      description: 'Users experiencing timeouts...',
      category: 'Infrastructure',
      severity: 'HIGH',
      priority: 'P2',
      status: 'ASSIGNED',
      assigned_to: 'developer@company.com',
      team: 'Backend',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      due_date: '2025-01-10T23:59:59Z',
      environment: 'PRODUCTION',
      error_message: 'Connection timeout after 30s',
      last_sync_at: new Date().toISOString(),
      tags: ['database', 'timeout', 'production']
    }
  });
}
```

### 2. Buscar Mis Incidencias Asignadas (desde Cline)

```typescript
// Query usando GSI-1
const myIncidents = await dynamodb.query({
  TableName: 'incidents',
  IndexName: 'GSI-1-assigned-status',
  KeyConditionExpression: 'assigned_to = :email',
  FilterExpression: '#status IN (:s1, :s2)',
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':email': 'developer@company.com',
    ':s1': 'ASSIGNED',
    ':s2': 'IN_PROGRESS'
  },
  ScanIndexForward: false  // Más recientes primero
});
```

### 3. Obtener Detalles de una Incidencia

```typescript
const incident = await dynamodb.getItem({
  TableName: 'incidents',
  Key: {
    incident_id: 'INC-12345',
    sk: 'METADATA'
  }
});
```

### 4. Actualizar Progreso desde Cline

```typescript
await dynamodb.updateItem({
  TableName: 'incidents',
  Key: {
    incident_id: 'INC-12345',
    sk: 'METADATA'
  },
  UpdateExpression: `
    SET #status = :status,
        cline_work = :work,
        updated_at = :now
  `,
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':status': 'IN_PROGRESS',
    ':work': {
      started_at: '2025-01-04T10:00:00Z',
      last_updated: new Date().toISOString(),
      developer: 'developer@company.com',
      analysis: {
        root_cause: 'Connection pool exhausted',
        diagnosis: 'Pool size too small for current load',
        similar_incidents_count: 3
      }
    },
    ':now': new Date().toISOString()
  }
});
```

### 5. Registrar Solución

```typescript
await dynamodb.updateItem({
  TableName: 'incidents',
  Key: {
    incident_id: 'INC-12345',
    sk: 'METADATA'
  },
  UpdateExpression: `
    SET cline_work.solution = :solution,
        #status = :status,
        updated_at = :now
  `,
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':solution': {
      description: 'Increased database connection pool size',
      steps: [
        'Analyzed current pool configuration',
        'Increased pool size from 5 to 20 connections',
        'Updated database.yml configuration',
        'Restarted application servers',
        'Verified no more timeouts'
      ],
      code_changes: [
        {
          file: 'config/database.yml',
          description: 'Increased pool size to 20'
        }
      ]
    },
    ':status': 'RESOLVED',
    ':now': new Date().toISOString()
  }
});
```

### 6. Cerrar Incidencia con Resolución

```typescript
await dynamodb.updateItem({
  TableName: 'incidents',
  Key: {
    incident_id: 'INC-12345',
    sk: 'METADATA'
  },
  UpdateExpression: `
    SET resolution = :resolution,
        #status = :status,
        resolved_at = :now,
        updated_at = :now
  `,
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':resolution': {
      resolved_by: 'developer@company.com',
      resolved_at: new Date().toISOString(),
      resolution_type: 'FIXED',
      description: 'Increased database connection pool size from 5 to 20',
      root_cause: 'Insufficient connection pool size for production load'
    },
    ':status': 'CLOSED',
    ':now': new Date().toISOString()
  }
});
```

### 7. Buscar Incidencias por Estado

```typescript
// Buscar todas las incidencias nuevas
const newIncidents = await dynamodb.query({
  TableName: 'incidents',
  IndexName: 'GSI-2-status-priority',
  KeyConditionExpression: '#status = :status',
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':status': 'NEW'
  },
  Limit: 20
});
```

## 💰 Estimación de Costos MVP

### Escenario: 500 incidencias activas, 50 nuevas/mes

**Almacenamiento:**
- Tamaño promedio: ~5 KB por incidencia
- 500 incidencias × 5 KB = 2.5 MB
- Costo: $0.25/GB/mes → **$0.0006/mes**

**Escrituras (On-Demand):**
- 50 importaciones/mes
- 200 actualizaciones/mes
- 250 escrituras × $1.25/millón = **$0.0003/mes**

**Lecturas (On-Demand):**
- 1,000 consultas/mes
- 1,000 lecturas × $0.25/millón = **$0.00025/mes**

**Total estimado: ~$0.001/mes** (menos de 1 centavo)

## 🚀 Plan de Implementación MVP

### Fase 1: Infraestructura (3 días)
- [ ] Crear tabla DynamoDB con SAM/CloudFormation
- [ ] Configurar 3 GSIs esenciales
- [ ] Habilitar PITR y backups
- [ ] Configurar permisos IAM básicos

### Fase 2: Servicio de Gestión (5 días)
- [ ] Crear `IncidentService` class
- [ ] Implementar `createIncident()`
- [ ] Implementar `getIncident()`
- [ ] Implementar `updateProgress()`
- [ ] Implementar `resolveIncident()`
- [ ] Implementar `searchMyIncidents()`
- [ ] Tests unitarios básicos

### Fase 3: Sincronización Jira (5 días)
- [ ] Crear `JiraSyncService` class
- [ ] Implementar autenticación Jira API
- [ ] Implementar importación de incidencias
- [ ] Script de sincronización manual
- [ ] Logging y manejo de errores

### Fase 4: Herramientas MCP (5 días)
- [ ] Crear herramienta `search_my_incidents`
- [ ] Crear herramienta `get_incident_details`
- [ ] Crear herramienta `update_incident_progress`
- [ ] Crear herramienta `resolve_incident`
- [ ] Documentación de herramientas

### Fase 5: Testing y Documentación (2 días)
- [ ] Tests de integración end-to-end
- [ ] Documentación de usuario
- [ ] Guía de troubleshooting
- [ ] README actualizado

**Total: ~20 días de desarrollo**

## 📚 Herramientas MCP MVP

### 1. `search_my_incidents`
Busca incidencias asignadas al desarrollador.

**Input:**
```typescript
{
  status?: 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED',
  limit?: number  // default: 10
}
```

**Output:**
```typescript
{
  incidents: Array<{
    incident_id: string;
    title: string;
    severity: string;
    priority: string;
    status: string;
    created_at: string;
    due_date?: string;
  }>;
  total: number;
}
```

### 2. `get_incident_details`
Obtiene detalles completos de una incidencia.

**Input:**
```typescript
{
  incident_id: string;
}
```

**Output:**
```typescript
{
  incident: Incident;  // Objeto completo
}
```

### 3. `update_incident_progress`
Actualiza el progreso de trabajo.

**Input:**
```typescript
{
  incident_id: string;
  analysis?: {
    root_cause?: string;
    diagnosis?: string;
  };
  progress_notes?: string;
}
```

**Output:**
```typescript
{
  success: boolean;
  updated_at: string;
}
```

### 4. `resolve_incident`
Marca incidencia como resuelta.

**Input:**
```typescript
{
  incident_id: string;
  solution: {
    description: string;
    steps: string[];
    code_changes?: Array<{
      file: string;
      description: string;
    }>;
  };
  resolution_type: 'FIXED' | 'WORKAROUND' | 'NOT_REPRODUCIBLE';
  root_cause?: string;
}
```

**Output:**
```typescript
{
  success: boolean;
  resolved_at: string;
}
```

## 🔐 Seguridad MVP

### Política IAM para Lambda (Sincronización)

```yaml
IncidentSyncPolicy:
  Type: AWS::IAM::Policy
  Properties:
    PolicyDocument:
      Statement:
        - Sid: DynamoDBIncidentAccess
          Effect: Allow
          Action:
            - dynamodb:PutItem
            - dynamodb:GetItem
            - dynamodb:UpdateItem
            - dynamodb:Query
          Resource:
            - !GetAtt IncidentsTable.Arn
            - !Sub '${IncidentsTable.Arn}/index/*'
```

### Política IAM para MCP Server (Cline)

```yaml
MCPIncidentAccessPolicy:
  Type: AWS::IAM::Policy
  Properties:
    PolicyDocument:
      Statement:
        - Sid: ReadWriteIncidents
          Effect: Allow
          Action:
            - dynamodb:GetItem
            - dynamodb:Query
            - dynamodb:UpdateItem
          Resource:
            - !GetAtt IncidentsTable.Arn
            - !Sub '${IncidentsTable.Arn}/index/*'
```

## 📝 Template CloudFormation MVP

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Incident Management MVP - DynamoDB Table

Resources:
  IncidentsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: incidents
      BillingMode: PAY_PER_REQUEST
      PointInTimeRecoverySpecification:
        PointInTimeRecoveryEnabled: true
      
      AttributeDefinitions:
        - AttributeName: incident_id
          AttributeType: S
        - AttributeName: sk
          AttributeType: S
        - AttributeName: assigned_to
          AttributeType: S
        - AttributeName: status_priority_created
          AttributeType: S
        - AttributeName: status
          AttributeType: S
        - AttributeName: priority_created
          AttributeType: S
        - AttributeName: source_system_external_id
          AttributeType: S
      
      KeySchema:
        - AttributeName: incident_id
          KeyType: HASH
        - AttributeName: sk
          KeyType: RANGE
      
      GlobalSecondaryIndexes:
        # GSI-1: Búsqueda por asignado
        - IndexName: GSI-1-assigned-status
          KeySchema:
            - AttributeName: assigned_to
              KeyType: HASH
            - AttributeName: status_priority_created
              KeyType: RANGE
          Projection:
            ProjectionType: ALL
        
        # GSI-2: Búsqueda por estado
        - IndexName: GSI-2-status-priority
          KeySchema:
            - AttributeName: status
              KeyType: HASH
            - AttributeName: priority_created
              KeyType: RANGE
          Projection:
            ProjectionType: ALL
        
        # GSI-3: Búsqueda por sistema origen
        - IndexName: GSI-3-source-external
          KeySchema:
            - AttributeName: source_system_external_id
              KeyType: HASH
            - AttributeName: sk
              KeyType: RANGE
          Projection:
            ProjectionType: KEYS_ONLY
      
      Tags:
        - Key: Project
          Value: IncidentManagement
        - Key: Environment
          Value: Production

Outputs:
  IncidentsTableName:
    Description: Nombre de la tabla de incidencias
    Value: !Ref IncidentsTable
    Export:
      Name: IncidentsTableName
  
  IncidentsTableArn:
    Description: ARN de la tabla de incidencias
    Value: !GetAtt IncidentsTable.Arn
    Export:
      Name: IncidentsTableArn
```

## 🎯 Criterios de Éxito MVP

1. ✅ Importar 100% de incidencias desde Jira sin errores
2. ✅ Búsqueda de incidencias < 100ms (P95)
3. ✅ Actualización de progreso funcional desde Cline
4. ✅ Resolución de incidencias con toda la información necesaria
5. ✅ Costo mensual < $1 para 1000 incidencias

## 📖 Próximos Pasos Post-MVP

1. Sincronización bidireccional automática
2. Versionado de incidencias
3. Métricas y dashboard
4. Notificaciones de SLA
5. Integración con más sistemas (Remedy, ServiceNow)
6. API REST para acceso externo

## 🔍 Diferencias con Diseño Completo

| Característica | MVP | Completo |
|----------------|-----|----------|
| Versionado | ❌ No | ✅ Sí |
| Sincronización bidireccional | ❌ No | ✅ Sí |
| Detección de conflictos | ❌ No | ✅ Sí |
| Métricas pre-calculadas | ❌ No | ✅ Sí |
| Dashboard | ❌ No | ✅ Sí |
| Reclamar incidencias | ❌ No | ✅ Sí |
| Comentarios | ❌ Limitado | ✅ Completo |
| Adjuntos | ❌ No | ✅ Sí |
| Tabla de métricas | ❌ No | ✅ Sí |
| Cola de sincronización | ❌ No | ✅ Sí |
