# Diseño del Módulo de Gestión de Incidencias en DynamoDB

## 📋 Objetivo

Diseñar e implementar una base de datos DynamoDB para gestionar incidencias operativas que:
1. Se sincronizan desde sistemas externos (Jira, Remedy, ServiceNow, etc.)
2. Permiten a desarrolladores trabajar sobre ellas desde Cline
3. Almacenan el progreso y resolución de las incidencias
4. Mantienen trazabilidad completa del ciclo de vida

## 🎯 Casos de Uso

### Sincronización desde Sistemas Externos
1. **Importar incidencias** desde Jira/Remedy/ServiceNow
2. **Actualizar estado** cuando cambia en el sistema origen
3. **Sincronización bidireccional** de comentarios y actualizaciones
4. **Detección de cambios** para evitar conflictos

### Trabajo desde Cline
1. **Buscar incidencias** asignadas o disponibles
2. **Reclamar incidencia** para trabajar en ella
3. **Actualizar progreso** mientras se trabaja
4. **Registrar solución** con pasos y código
5. **Cerrar incidencia** con resolución completa

### Gestión y Reporting
1. **Dashboard de incidencias** activas
2. **Métricas de resolución** por desarrollador/equipo
3. **Análisis de patrones** de incidencias
4. **Auditoría completa** de cambios

## 🗄️ Diseño de Tablas DynamoDB

### Tabla Principal: `incidents`

#### Estructura de Claves

```
Partition Key (PK): incident_id (String)
Sort Key (SK): version (Number)
```

**Justificación del diseño:**
- **PK = incident_id**: Identificador único de la incidencia (ej: "JIRA-12345", "INC0012345")
- **SK = version**: Permite versionado completo de la incidencia
- Versión 0 = registro actual/activo
- Versiones > 0 = historial de cambios

#### Atributos Principales

```typescript
interface Incident {
  // Claves primarias
  incident_id: string;                // PK: ID único (JIRA-12345, INC0012345)
  version: number;                    // SK: 0 = actual, >0 = histórico
  
  // Identificación
  external_id: string;                // ID en el sistema origen
  source_system: 'JIRA' | 'REMEDY' | 'SERVICENOW' | 'MANUAL';
  source_url?: string;                // URL al ticket original
  
  // Información básica
  title: string;
  description: string;
  category: string;                   // 'Infrastructure', 'Application', 'Network', etc.
  subcategory?: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  
  // Estado y asignación
  status: 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'PENDING' | 'RESOLVED' | 'CLOSED' | 'CANCELLED';
  assigned_to?: string;               // Usuario asignado
  assigned_at?: string;               // Timestamp de asignación
  team?: string;                      // Equipo responsable
  
  // Fechas importantes
  created_at: string;                 // ISO 8601
  updated_at: string;                 // ISO 8601
  due_date?: string;                  // Fecha límite
  resolved_at?: string;               // Fecha de resolución
  closed_at?: string;                 // Fecha de cierre
  
  // Información técnica
  affected_systems: string[];         // Sistemas afectados
  affected_services: string[];        // Servicios afectados
  environment: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT' | 'QA';
  
  // Contexto técnico
  technical_details: {
    error_messages?: string[];
    stack_traces?: string[];
    log_references?: string[];
    affected_components?: string[];
    related_incidents?: string[];     // IDs de incidencias relacionadas
  };
  
  // Trabajo realizado desde Cline
  cline_work?: {
    started_at: string;
    last_updated: string;
    developer: string;
    session_id: string;
    workspace: string;
    
    // Análisis realizado
    analysis?: {
      root_cause: string;
      diagnosis: string;
      similar_incidents_found: number;
    };
    
    // Solución propuesta
    solution?: {
      description: string;
      steps: string[];
      code_changes?: Array<{
        file: string;
        description: string;
        diff?: string;
      }>;
      commands_executed?: string[];
      tests_performed?: string[];
    };
    
    // Tiempo invertido
    time_tracking: {
      total_minutes: number;
      sessions: Array<{
        session_id: string;
        started_at: string;
        ended_at: string;
        duration_minutes: number;
      }>;
    };
  };
  
  // Resolución
  resolution?: {
    resolved_by: string;
    resolved_at: string;
    resolution_type: 'FIXED' | 'WORKAROUND' | 'DUPLICATE' | 'NOT_REPRODUCIBLE' | 'WONT_FIX';
    resolution_description: string;
    root_cause: string;
    preventive_actions?: string[];
    documentation_updated: boolean;
    kb_article_created?: string;      // ID del artículo en KB
  };
  
  // Comentarios y actualizaciones
  comments: Array<{
    comment_id: string;
    author: string;
    timestamp: string;
    text: string;
    source: 'CLINE' | 'JIRA' | 'REMEDY' | 'MANUAL';
    visibility: 'PUBLIC' | 'INTERNAL';
  }>;
  
  // Adjuntos
  attachments: Array<{
    attachment_id: string;
    filename: string;
    s3_path: string;
    uploaded_by: string;
    uploaded_at: string;
    size_bytes: number;
    mime_type: string;
  }>;
  
  // Sincronización
  sync_metadata: {
    last_sync_at: string;
    last_sync_status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
    sync_errors?: string[];
    external_version?: string;        // Versión en sistema origen
    needs_sync: boolean;              // Flag para sincronización pendiente
  };
  
  // Métricas
  metrics: {
    response_time_minutes?: number;   // Tiempo hasta primera respuesta
    resolution_time_minutes?: number; // Tiempo total de resolución
    reopened_count: number;           // Veces que se reabrió
    escalated: boolean;
    sla_breached: boolean;
  };
  
  // Tags y clasificación
  tags: string[];
  labels: string[];
  
  // Metadatos
  metadata: {
    created_by: string;
    last_modified_by: string;
    version_notes?: string;           // Notas de esta versión
  };
}
```

#### Índices Secundarios Globales (GSI)

**GSI-1: Búsqueda por Estado y Prioridad**
```
PK: status (String)
SK: priority#created_at (String)
Projection: ALL
```
Uso: Listar incidencias por estado ordenadas por prioridad y fecha

**GSI-2: Búsqueda por Asignado**
```
PK: assigned_to (String)
SK: status#priority (String)
Projection: ALL
```
Uso: Ver incidencias asignadas a un desarrollador

**GSI-3: Búsqueda por Equipo**
```
PK: team (String)
SK: status#created_at (String)
Projection: ALL
```
Uso: Dashboard de equipo

**GSI-4: Búsqueda por Categoría**
```
PK: category (String)
SK: severity#created_at (String)
Projection: KEYS_ONLY
```
Uso: Análisis por tipo de incidencia

**GSI-5: Búsqueda por Sistema Origen**
```
PK: source_system (String)
SK: external_id (String)
Projection: KEYS_ONLY
```
Uso: Sincronización y deduplicación

**GSI-6: Búsqueda por Fecha de Vencimiento**
```
PK: status (String)
SK: due_date (String)
Projection: ALL
```
Uso: Alertas de SLA y vencimientos

### Tabla Secundaria: `incident-sync-queue`

Cola de sincronización para cambios pendientes.

```typescript
interface IncidentSyncQueue {
  // Claves
  sync_id: string;                    // PK: UUID
  timestamp: string;                  // SK: ISO 8601
  
  // Información de sincronización
  incident_id: string;
  source_system: string;
  sync_direction: 'TO_EXTERNAL' | 'FROM_EXTERNAL';
  sync_type: 'CREATE' | 'UPDATE' | 'COMMENT' | 'ATTACHMENT' | 'STATUS_CHANGE';
  
  // Datos a sincronizar
  payload: Record<string, any>;
  
  // Estado
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  attempts: number;
  max_attempts: number;
  last_attempt_at?: string;
  error_message?: string;
  
  // TTL (auto-eliminar después de 7 días)
  ttl: number;
}
```

### Tabla Terciaria: `incident-metrics`

Agregaciones y métricas pre-calculadas.

```typescript
interface IncidentMetrics {
  // Claves
  metric_key: string;                 // PK: "team:TEAM_NAME:2025-01" o "user:USER_ID:2025-W01"
  metric_type: string;                // SK: "summary" | "by_category" | "by_severity"
  
  // Período
  period_start: string;
  period_end: string;
  
  // Métricas
  total_incidents: number;
  new_incidents: number;
  resolved_incidents: number;
  closed_incidents: number;
  avg_resolution_time_minutes: number;
  median_resolution_time_minutes: number;
  sla_compliance_rate: number;
  
  // Por severidad
  by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  
  // Por categoría
  by_category: Record<string, number>;
  
  // Top incidencias
  most_common_issues: Array<{
    category: string;
    count: number;
  }>;
  
  // Actualización
  last_calculated_at: string;
  
  // TTL (mantener 1 año)
  ttl: number;
}
```

## 🔧 Configuración de DynamoDB

### Capacidad

**Tabla `incidents`:**
- Modo: **On-Demand** (recomendado para inicio)
- Alternativa Provisioned: 10 RCU / 10 WCU

**Tabla `incident-sync-queue`:**
- Modo: **On-Demand**
- Alta variabilidad en carga de sincronización

**Tabla `incident-metrics`:**
- Modo: **Provisioned**: 5 RCU / 2 WCU
- Escrituras predecibles (agregaciones programadas)

### TTL (Time To Live)

**Tabla `incidents`:**
- No usar TTL en registros principales
- Mantener historial completo

**Tabla `incident-sync-queue`:**
- TTL: 7 días después de completar
- Limpia automáticamente registros procesados

**Tabla `incident-metrics`:**
- TTL: 365 días
- Mantiene métricas del último año

### Backup

- **PITR**: Habilitado en tabla `incidents`
- **Backups diarios**: Automáticos con retención de 35 días
- **Backups mensuales**: Manuales con retención de 1 año

### Encriptación

- **At rest**: AWS managed KMS keys
- **In transit**: TLS 1.2+
- **Campos sensibles**: Considerar encriptación adicional a nivel de aplicación

## 📊 Patrones de Acceso

### 1. Sincronizar Nueva Incidencia desde Jira

```typescript
// 1. Verificar si existe
const existing = await dynamodb.query({
  TableName: 'incidents',
  IndexName: 'GSI-5-source-external',
  KeyConditionExpression: 'source_system = :sys AND external_id = :eid',
  ExpressionAttributeValues: {
    ':sys': 'JIRA',
    ':eid': 'JIRA-12345'
  }
});

// 2. Si no existe, crear
if (existing.Items.length === 0) {
  await dynamodb.putItem({
    TableName: 'incidents',
    Item: {
      incident_id: 'INC-' + uuid(),
      version: 0,
      external_id: 'JIRA-12345',
      source_system: 'JIRA',
      // ... resto de campos
    }
  });
}
```

### 2. Buscar Incidencias Asignadas a Desarrollador

```typescript
// Query usando GSI-2
const result = await dynamodb.query({
  TableName: 'incidents',
  IndexName: 'GSI-2-assigned-status',
  KeyConditionExpression: 'assigned_to = :user',
  FilterExpression: 'version = :v AND #status IN (:s1, :s2)',
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':user': 'developer@example.com',
    ':v': 0,  // Solo versión actual
    ':s1': 'ASSIGNED',
    ':s2': 'IN_PROGRESS'
  }
});
```

### 3. Reclamar Incidencia para Trabajar

```typescript
// Update condicional para evitar conflictos
await dynamodb.updateItem({
  TableName: 'incidents',
  Key: {
    incident_id: 'INC-12345',
    version: 0
  },
  UpdateExpression: 'SET #status = :new_status, assigned_to = :user, assigned_at = :now, updated_at = :now',
  ConditionExpression: '#status = :old_status AND attribute_not_exists(assigned_to)',
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':old_status': 'NEW',
    ':new_status': 'ASSIGNED',
    ':user': 'developer@example.com',
    ':now': new Date().toISOString()
  }
});
```

### 4. Actualizar Progreso desde Cline

```typescript
await dynamodb.updateItem({
  TableName: 'incidents',
  Key: {
    incident_id: 'INC-12345',
    version: 0
  },
  UpdateExpression: `
    SET cline_work.last_updated = :now,
        cline_work.analysis = :analysis,
        #status = :status,
        updated_at = :now
  `,
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':now': new Date().toISOString(),
    ':analysis': {
      root_cause: 'Database connection timeout',
      diagnosis: 'Connection pool exhausted',
      similar_incidents_found: 3
    },
    ':status': 'IN_PROGRESS'
  }
});
```

### 5. Registrar Solución

```typescript
await dynamodb.updateItem({
  TableName: 'incidents',
  Key: {
    incident_id: 'INC-12345',
    version: 0
  },
  UpdateExpression: `
    SET cline_work.solution = :solution,
        resolution = :resolution,
        #status = :status,
        resolved_at = :now,
        updated_at = :now
  `,
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':solution': {
      description: 'Increased connection pool size',
      steps: [
        'Updated database.yml configuration',
        'Increased pool size from 5 to 20',
        'Restarted application servers'
      ],
      code_changes: [{
        file: 'config/database.yml',
        description: 'Increased pool size',
        diff: '- pool: 5\n+ pool: 20'
      }]
    },
    ':resolution': {
      resolved_by: 'developer@example.com',
      resolved_at: new Date().toISOString(),
      resolution_type: 'FIXED',
      resolution_description: 'Increased database connection pool',
      root_cause: 'Insufficient connection pool size',
      documentation_updated: true
    },
    ':status': 'RESOLVED',
    ':now': new Date().toISOString()
  }
});
```

### 6. Buscar Incidencias Críticas Pendientes

```typescript
const result = await dynamodb.query({
  TableName: 'incidents',
  IndexName: 'GSI-1-status-priority',
  KeyConditionExpression: '#status = :status AND begins_with(priority_created, :priority)',
  FilterExpression: 'version = :v',
  ExpressionAttributeNames: {
    '#status': 'status'
  },
  ExpressionAttributeValues: {
    ':status': 'NEW',
    ':priority': 'P1#',
    ':v': 0
  }
});
```

### 7. Crear Versión Histórica (antes de actualización importante)

```typescript
// 1. Leer versión actual
const current = await dynamodb.getItem({
  TableName: 'incidents',
  Key: { incident_id: 'INC-12345', version: 0 }
});

// 2. Obtener siguiente número de versión
const versions = await dynamodb.query({
  TableName: 'incidents',
  KeyConditionExpression: 'incident_id = :id',
  ExpressionAttributeValues: { ':id': 'INC-12345' },
  ScanIndexForward: false,
  Limit: 1
});
const nextVersion = (versions.Items[0]?.version || 0) + 1;

// 3. Guardar versión histórica
await dynamodb.putItem({
  TableName: 'incidents',
  Item: {
    ...current.Item,
    version: nextVersion,
    metadata: {
      ...current.Item.metadata,
      version_notes: 'Snapshot before resolution'
    }
  }
});

// 4. Actualizar versión actual
await dynamodb.updateItem({
  TableName: 'incidents',
  Key: { incident_id: 'INC-12345', version: 0 },
  UpdateExpression: 'SET ...'
});
```

## 💰 Estimación de Costos

### Escenario: 1,000 incidencias activas, 100 nuevas/mes

**Almacenamiento:**
- Tamaño promedio por incidencia: ~10 KB
- 1,000 incidencias × 10 KB = 10 MB
- Con historial (3 versiones promedio): 30 MB
- Costo: $0.25/GB/mes → **$0.0075/mes**

**Escrituras (On-Demand):**
- 100 nuevas incidencias/mes
- 500 actualizaciones/mes
- 600 escrituras × $1.25/millón = **$0.00075/mes**

**Lecturas (On-Demand):**
- 2,000 consultas/mes (desarrolladores buscando)
- 2,000 lecturas × $0.25/millón = **$0.0005/mes**

**Total estimado: ~$0.01/mes** (prácticamente gratis)

### Escenario: 10,000 incidencias activas, 1,000 nuevas/mes

**Almacenamiento:**
- 10,000 × 10 KB × 3 versiones = 300 MB
- Costo: **$0.075/mes**

**Escrituras:**
- 1,000 nuevas + 5,000 actualizaciones = 6,000 escrituras
- Costo: **$0.0075/mes**

**Lecturas:**
- 20,000 consultas/mes
- Costo: **$0.005/mes**

**Total estimado: ~$0.09/mes**

## 🔐 Seguridad y Permisos

### Política IAM para Lambda (Sincronización)

```yaml
- Sid: IncidentManagement
  Effect: Allow
  Action:
    - dynamodb:PutItem
    - dynamodb:GetItem
    - dynamodb:UpdateItem
    - dynamodb:Query
    - dynamodb:BatchWriteItem
  Resource:
    - !GetAtt IncidentsTable.Arn
    - !Sub '${IncidentsTable.Arn}/index/*'
```

### Política IAM para Desarrolladores (desde Cline)

```yaml
- Sid: DeveloperIncidentAccess
  Effect: Allow
  Action:
    - dynamodb:GetItem
    - dynamodb:Query
    - dynamodb:UpdateItem
  Resource:
    - !GetAtt IncidentsTable.Arn
    - !Sub '${IncidentsTable.Arn}/index/*'
  Condition:
    StringEquals:
      dynamodb:LeadingKeys:
        - ${aws:username}  # Solo incidencias asignadas
```

## 🚀 Plan de Implementación

### Fase 1: Infraestructura Base (Semana 1)
- [ ] Crear tabla `incidents` con CloudFormation
- [ ] Configurar todos los GSIs
- [ ] Configurar backups y PITR
- [ ] Crear tabla `incident-sync-queue`
- [ ] Configurar alarmas CloudWatch

### Fase 2: Servicio de Gestión (Semana 2)
- [ ] Crear `IncidentService` class
- [ ] Implementar CRUD básico
- [ ] Implementar búsquedas por GSIs
- [ ] Implementar versionado
- [ ] Tests unitarios

### Fase 3: Sincronización Jira (Semana 3)
- [ ] Crear `JiraSyncService`
- [ ] Implementar importación de incidencias
- [ ] Implementar sincronización bidireccional
- [ ] Manejar conflictos
- [ ] Tests de integración

### Fase 4: Integración con Cline (Semana 4)
- [ ] Crear herramienta MCP `search_my_incidents`
- [ ] Crear herramienta MCP `claim_incident`
- [ ] Crear herramienta MCP `update_incident_progress`
- [ ] Crear herramienta MCP `resolve_incident`
- [ ] Documentar herramientas

### Fase 5: Métricas y Reporting (Semana 5)
- [ ] Crear tabla `incident-metrics`
- [ ] Implementar agregaciones
- [ ] Crear dashboard CloudWatch
- [ ] Implementar alertas SLA

## 📚 Herramientas MCP Propuestas

### 1. `search_my_incidents`
Busca incidencias asignadas al desarrollador actual.

**Parámetros:**
- `status`: Filtrar por estado (opcional)
- `priority`: Filtrar por prioridad (opcional)
- `limit`: Número máximo de resultados

### 2. `get_incident_details`
Obtiene detalles completos de una incidencia.

**Parámetros:**
- `incident_id`: ID de la incidencia

### 3. `claim_incident`
Reclama una incidencia para trabajar en ella.

**Parámetros:**
- `incident_id`: ID de la incidencia

### 4. `update_incident_progress`
Actualiza el progreso de trabajo en una incidencia.

**Parámetros:**
- `incident_id`: ID de la incidencia
- `analysis`: Análisis realizado (opcional)
- `progress_notes`: Notas de progreso

### 5. `resolve_incident`
Marca una incidencia como resuelta con la solución.

**Parámetros:**
- `incident_id`: ID de la incidencia
- `solution`: Descripción de la solución
- `steps`: Pasos realizados
- `code_changes`: Cambios de código (opcional)

### 6. `add_incident_comment`
Añade un comentario a una incidencia.

**Parámetros:**
- `incident_id`: ID de la incidencia
- `comment`: Texto del comentario

## 🎯 Métricas de Éxito

1. **Sincronización**: < 5 minutos de latencia desde Jira
2. **Disponibilidad**: > 99.9% uptime
3. **Latencia de consultas**: P95 < 100ms
4. **Adopción**: > 80% de desarrolladores usan Cline para incidencias
5. **Precisión**: 100% de sincronización sin pérdida de datos

## 📖 Referencias

- [DynamoDB Single-Table Design](https://aws.amazon.com/blogs/compute/creating-a-single-table-design-with-amazon-dynamodb/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [Jira REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [Remedy REST API](https://docs.bmc.com/docs/ars2002/remedy-rest-api-overview-941427470.html)
