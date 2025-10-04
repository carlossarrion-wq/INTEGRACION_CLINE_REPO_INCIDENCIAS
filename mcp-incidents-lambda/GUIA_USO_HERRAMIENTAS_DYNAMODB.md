# Guía de Uso - Herramientas DynamoDB para Gestión de Incidencias

## Resumen

Se han implementado 5 nuevas herramientas MCP para gestionar incidencias en DynamoDB desde el cliente Cline. Estas herramientas permiten el ciclo completo de vida de una incidencia: consulta, actualización de progreso, resolución y cierre.

## Arquitectura

```
┌─────────────────┐
│  Cline Client   │
└────────┬────────┘
         │ MCP Protocol
         ▼
┌─────────────────────────────────────┐
│   MCP Local Server (index-local.js) │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ Knowledge Base Tools         │  │
│  │ - search_similar_incidents   │  │
│  │   (via Lambda wrapper)       │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ DynamoDB Incident Tools      │  │
│  │ - get_incident               │  │
│  │ - search_my_incidents        │  │
│  │ - update_incident            │  │
│  │ - resolve_incident           │  │
│  │ - close_incident             │  │
│  │   (acceso directo a DynamoDB)│  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│   DynamoDB      │
│ incidents-table │
└─────────────────┘
```

## Herramientas Disponibles

### 1. get_incident

**Propósito**: Obtener los detalles completos de una incidencia por su ID.

**Parámetros**:
- `incident_id` (requerido): ID único de la incidencia (ej: INC-1759575610487-WC5F2I)

**Ejemplo de uso**:
```json
{
  "incident_id": "INC-1759575610487-WC5F2I"
}
```

**Respuesta exitosa**:
```json
{
  "success": true,
  "found": true,
  "incident": {
    "incident_id": "INC-1759575610487-WC5F2I",
    "title": "Error en API de pagos",
    "description": "...",
    "status": "IN_PROGRESS",
    "severity": "HIGH",
    "priority": "P1",
    "assigned_to": "developer@company.com",
    "cline_work": {
      "started_at": "2025-01-04T10:00:00Z",
      "developer": "developer@company.com",
      "analysis": {...},
      "solution": {...}
    },
    ...
  }
}
```

### 2. search_my_incidents

**Propósito**: Buscar incidencias asignadas a un usuario específico.

**Parámetros**:
- `assigned_to` (requerido): Email del usuario (ej: developer@company.com)
- `status` (opcional): Filtrar por estado (NEW, ASSIGNED, IN_PROGRESS, RESOLVED, CLOSED)
- `limit` (opcional): Número máximo de resultados (default: 20, max: 50)

**Ejemplo de uso**:
```json
{
  "assigned_to": "developer@company.com",
  "status": "IN_PROGRESS",
  "limit": 10
}
```

**Respuesta exitosa**:
```json
{
  "success": true,
  "incidents": [
    {
      "incident_id": "INC-1759575610487-WC5F2I",
      "external_id": "JIRA-12345",
      "title": "Error en API de pagos",
      "status": "IN_PROGRESS",
      "severity": "HIGH",
      "priority": "P1",
      "assigned_to": "developer@company.com",
      "created_at": "2025-01-04T10:00:00Z",
      "category": "Backend"
    }
  ],
  "count": 1,
  "filters": {
    "assigned_to": "developer@company.com",
    "status": "IN_PROGRESS"
  }
}
```

### 3. update_incident

**Propósito**: Actualizar el progreso de trabajo en una incidencia. Cambia automáticamente el estado a IN_PROGRESS.

**Parámetros**:
- `incident_id` (requerido): ID de la incidencia
- `developer` (requerido): Email del desarrollador
- `session_id` (opcional): ID de la sesión de Cline
- `workspace` (opcional): Nombre del workspace/proyecto
- `analysis` (opcional): Objeto con análisis realizado
  - `root_cause`: Causa raíz identificada
  - `diagnosis`: Diagnóstico del problema
  - `similar_incidents_count`: Número de incidencias similares
- `progress_notes` (opcional): Notas adicionales

**Ejemplo de uso**:
```json
{
  "incident_id": "INC-1759575610487-WC5F2I",
  "developer": "developer@company.com",
  "session_id": "cline-session-123",
  "workspace": "payment-service",
  "analysis": {
    "root_cause": "Timeout en conexión a base de datos",
    "diagnosis": "El pool de conexiones está saturado durante picos de tráfico",
    "similar_incidents_count": 3
  },
  "progress_notes": "Investigando configuración del pool de conexiones"
}
```

**Respuesta exitosa**:
```json
{
  "success": true,
  "message": "Incidencia actualizada exitosamente",
  "incident": {
    "incident_id": "INC-1759575610487-WC5F2I",
    "title": "Error en API de pagos",
    "status": "IN_PROGRESS",
    "updated_at": "2025-01-04T11:30:00Z",
    "cline_work": {
      "started_at": "2025-01-04T10:00:00Z",
      "last_updated": "2025-01-04T11:30:00Z",
      "developer": "developer@company.com",
      "session_id": "cline-session-123",
      "workspace": "payment-service",
      "analysis": {...}
    }
  }
}
```

### 4. resolve_incident

**Propósito**: Marcar una incidencia como RESUELTA con la solución implementada. Prepara la incidencia para sincronización con Knowledge Base.

**Parámetros**:
- `incident_id` (requerido): ID de la incidencia
- `resolved_by` (requerido): Email del desarrollador que resolvió
- `resolution_type` (requerido): Tipo de resolución
  - `FIXED`: Solucionado permanentemente
  - `WORKAROUND`: Solución temporal
  - `NOT_REPRODUCIBLE`: No se pudo reproducir
- `description` (requerido): Descripción detallada de la resolución
- `root_cause` (opcional): Causa raíz del problema
- `solution` (opcional): Objeto con detalles de la solución
  - `description`: Descripción de la solución
  - `steps`: Array de pasos realizados
  - `code_changes`: Array de cambios de código
  - `commands_executed`: Array de comandos ejecutados
  - `tests_performed`: Array de pruebas realizadas
- `preventive_actions` (opcional): Array de acciones preventivas

**Ejemplo de uso**:
```json
{
  "incident_id": "INC-1759575610487-WC5F2I",
  "resolved_by": "developer@company.com",
  "resolution_type": "FIXED",
  "description": "Se aumentó el tamaño del pool de conexiones y se implementó circuit breaker",
  "root_cause": "Pool de conexiones insuficiente para el volumen de tráfico",
  "solution": {
    "description": "Configuración optimizada del pool de conexiones",
    "steps": [
      "Aumentar max_connections de 10 a 50",
      "Implementar circuit breaker con Resilience4j",
      "Añadir métricas de monitoreo del pool"
    ],
    "code_changes": [
      {
        "file": "src/config/database.ts",
        "description": "Aumentar tamaño del pool",
        "diff": "- max_connections: 10\n+ max_connections: 50"
      }
    ],
    "commands_executed": [
      "npm install @resilience4j/circuitbreaker",
      "npm test"
    ],
    "tests_performed": [
      "Test de carga con 1000 requests concurrentes",
      "Verificación de circuit breaker en caso de fallo"
    ]
  },
  "preventive_actions": [
    "Implementar alertas cuando el pool alcance 80% de uso",
    "Revisar configuración de pools en otros servicios"
  ]
}
```

**Respuesta exitosa**:
```json
{
  "success": true,
  "message": "Incidencia resuelta exitosamente",
  "incident": {
    "incident_id": "INC-1759575610487-WC5F2I",
    "title": "Error en API de pagos",
    "status": "RESOLVED",
    "resolved_at": "2025-01-04T12:00:00Z",
    "resolution": {
      "resolved_by": "developer@company.com",
      "resolved_at": "2025-01-04T12:00:00Z",
      "resolution_type": "FIXED",
      "description": "...",
      "root_cause": "...",
      "preventive_actions": [...]
    },
    "kb_sync_status": {
      "synced": false,
      "sync_attempts": 0
    }
  }
}
```

### 5. close_incident

**Propósito**: Cerrar una incidencia que ha sido previamente resuelta. Solo se pueden cerrar incidencias en estado RESOLVED.

**Parámetros**:
- `incident_id` (requerido): ID de la incidencia
- `closed_by` (requerido): Email del usuario que cierra
- `closure_notes` (opcional): Notas adicionales sobre el cierre

**Ejemplo de uso**:
```json
{
  "incident_id": "INC-1759575610487-WC5F2I",
  "closed_by": "developer@company.com",
  "closure_notes": "Verificado en producción durante 48 horas sin incidencias"
}
```

**Respuesta exitosa**:
```json
{
  "success": true,
  "message": "Incidencia cerrada exitosamente",
  "incident": {
    "incident_id": "INC-1759575610487-WC5F2I",
    "title": "Error en API de pagos",
    "status": "CLOSED",
    "updated_at": "2025-01-04T14:00:00Z",
    "kb_sync_status": {
      "synced": false,
      "sync_attempts": 0
    }
  }
}
```

## Flujo de Trabajo Típico

### Escenario: Desarrollador trabaja en una incidencia desde Cline

1. **Buscar mis incidencias asignadas**:
   ```
   Usar: search_my_incidents
   Parámetros: { "assigned_to": "developer@company.com", "status": "NEW" }
   ```

2. **Obtener detalles de una incidencia específica**:
   ```
   Usar: get_incident
   Parámetros: { "incident_id": "INC-1759575610487-WC5F2I" }
   ```

3. **Buscar incidencias similares en Knowledge Base** (opcional):
   ```
   Usar: search_similar_incidents
   Parámetros: { "query": "Error en API de pagos timeout database" }
   ```

4. **Actualizar progreso mientras se trabaja**:
   ```
   Usar: update_incident
   Parámetros: {
     "incident_id": "INC-1759575610487-WC5F2I",
     "developer": "developer@company.com",
     "analysis": {
       "diagnosis": "Pool de conexiones saturado",
       "similar_incidents_count": 3
     },
     "progress_notes": "Implementando solución basada en casos similares"
   }
   ```

5. **Marcar como resuelta al terminar**:
   ```
   Usar: resolve_incident
   Parámetros: {
     "incident_id": "INC-1759575610487-WC5F2I",
     "resolved_by": "developer@company.com",
     "resolution_type": "FIXED",
     "description": "Aumentado pool de conexiones e implementado circuit breaker",
     "root_cause": "Pool insuficiente",
     "solution": { ... },
     "preventive_actions": ["Implementar alertas", "Revisar otros servicios"]
   }
   ```

6. **Cerrar la incidencia tras verificación**:
   ```
   Usar: close_incident
   Parámetros: {
     "incident_id": "INC-1759575610487-WC5F2I",
     "closed_by": "developer@company.com",
     "closure_notes": "Verificado en producción 48h sin problemas"
   }
   ```

## Estados de Incidencia

```
NEW → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED
```

- **NEW**: Incidencia recién creada, sin asignar
- **ASSIGNED**: Asignada a un desarrollador
- **IN_PROGRESS**: Desarrollador trabajando activamente (se establece automáticamente al usar update_incident)
- **RESOLVED**: Solución implementada, pendiente de verificación
- **CLOSED**: Verificada y cerrada, lista para sincronización con KB

## Sincronización con Knowledge Base

Las incidencias cerradas se marcan con `kb_sync_status.synced = false` y serán sincronizadas automáticamente con Bedrock Knowledge Base mediante un proceso batch (Lambda programada).

Una vez sincronizadas:
- `kb_sync_status.synced = true`
- `kb_sync_status.synced_at = "2025-01-04T15:00:00Z"`

## Variables de Entorno Requeridas

Para que el servidor MCP funcione correctamente, necesita:

```bash
AWS_REGION=eu-west-1
DYNAMODB_TABLE_NAME=incidents-table
LAMBDA_FUNCTION_NAME=mcp-incidents-kb-wrapper  # Para search_similar_incidents
```

## Configuración en Cline

El servidor MCP debe estar configurado en Cline:

```json
{
  "mcpServers": {
    "incidents-analyzer": {
      "command": "node",
      "args": ["/ruta/completa/mcp-incidents-lambda/dist/index-local.js"],
      "env": {
        "AWS_REGION": "eu-west-1",
        "DYNAMODB_TABLE_NAME": "incidents-table",
        "LAMBDA_FUNCTION_NAME": "mcp-incidents-kb-wrapper"
      }
    }
  }
}
```

## Manejo de Errores

Todas las herramientas devuelven respuestas estructuradas con `success: true/false`:

**Error típico**:
```json
{
  "success": false,
  "error": "Incidencia no encontrada",
  "hint": "Verifica que el incident_id sea correcto"
}
```

**Errores comunes**:
- Incidencia no encontrada
- Estado inválido para la operación (ej: intentar cerrar una incidencia que no está RESOLVED)
- Parámetros requeridos faltantes
- Errores de conexión a DynamoDB

## Testing

Para probar las herramientas localmente:

1. **Verificar datos de prueba**:
   ```bash
   cd mcp-incidents-lambda
   npm run backfill
   ```

2. **Iniciar el servidor MCP**:
   ```bash
   node dist/index-local.js
   ```

3. **Usar desde Cline**: Las herramientas aparecerán automáticamente en el menú de herramientas MCP de Cline.

## Próximos Pasos

1. ✅ Herramientas DynamoDB implementadas y funcionando
2. ⏳ Testing desde cliente Cline
3. ⏳ Implementar sincronización batch con Knowledge Base
4. ⏳ Implementar conectores para Jira/Remedy/ServiceNow
5. ⏳ Dashboard de métricas y monitoreo

## Soporte

Para problemas o preguntas:
- Revisar logs del servidor MCP en stderr
- Verificar configuración de AWS credentials
- Consultar `LECCIONES_APRENDIDAS.md` para problemas conocidos
