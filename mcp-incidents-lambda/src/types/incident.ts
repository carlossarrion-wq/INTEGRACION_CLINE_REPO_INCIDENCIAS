/**
 * Incident Management Types for DynamoDB
 */

/**
 * Sistema origen de la incidencia
 */
export type SourceSystem = 'JIRA' | 'REMEDY' | 'SERVICENOW';

/**
 * Estado de la incidencia
 */
export type IncidentStatus = 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

/**
 * Severidad de la incidencia
 */
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Prioridad de la incidencia
 */
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

/**
 * Entorno afectado
 */
export type Environment = 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT';

/**
 * Tipo de resolución
 */
export type ResolutionType = 'FIXED' | 'WORKAROUND' | 'NOT_REPRODUCIBLE';

/**
 * Análisis realizado desde Cline
 */
export interface ClineAnalysis {
  root_cause?: string;
  diagnosis?: string;
  similar_incidents_count?: number;
}

/**
 * Cambio de código realizado
 */
export interface CodeChange {
  file: string;
  description: string;
  diff?: string;
}

/**
 * Solución implementada desde Cline
 */
export interface ClineSolution {
  description: string;
  steps: string[];
  code_changes?: CodeChange[];
  commands_executed?: string[];
  tests_performed?: string[];
}

/**
 * Trabajo realizado desde Cline
 */
export interface ClineWork {
  started_at: string;
  last_updated: string;
  developer: string;
  session_id?: string;
  workspace?: string;
  analysis?: ClineAnalysis;
  solution?: ClineSolution;
}

/**
 * Resolución de la incidencia
 */
export interface IncidentResolution {
  resolved_by: string;
  resolved_at: string;
  resolution_type: ResolutionType;
  description: string;
  root_cause?: string;
  preventive_actions?: string[];
}

/**
 * Adjunto de la incidencia
 */
export interface IncidentAttachment {
  attachment_id: string;
  filename: string;
  s3_path: string;
  uploaded_by: string;
  uploaded_at: string;
  size_bytes: number;
  mime_type: string;
}

/**
 * Estado de sincronización con Knowledge Base
 */
export interface KBSyncStatus {
  synced: boolean;
  synced_at?: string;
  sync_attempts: number;
  last_sync_attempt?: string;
  last_sync_error?: string;
}

/**
 * Incidencia completa (registro en DynamoDB)
 */
export interface Incident {
  // Claves primarias
  incident_id: string;
  sk: string; // Siempre "METADATA"
  
  // Identificación del sistema origen
  external_id: string;
  source_system: SourceSystem;
  source_url?: string;
  
  // Información básica
  title: string;
  description: string;
  category: string;
  severity: Severity;
  priority: Priority;
  
  // Estado y asignación
  status: IncidentStatus;
  assigned_to?: string;
  assigned_at?: string;
  team?: string;
  
  // Fechas
  created_at: string;
  updated_at: string;
  due_date?: string;
  resolved_at?: string;
  
  // Información técnica básica
  affected_systems?: string[];
  environment?: Environment;
  error_message?: string;
  
  // Trabajo realizado desde Cline
  cline_work?: ClineWork;
  
  // Resolución
  resolution?: IncidentResolution;
  
  // Adjuntos
  attachments?: IncidentAttachment[];
  
  // Sincronización con KB
  kb_sync_status?: KBSyncStatus;
  
  // Sincronización con sistema origen
  last_sync_at: string;
  
  // Tags
  tags?: string[];
  
  // Atributos compuestos para GSIs (calculados)
  status_priority_created?: string; // Para GSI-1: "ASSIGNED#P1#2025-01-04T10:00:00Z"
  priority_created?: string; // Para GSI-2: "P1#2025-01-04T10:00:00Z"
  source_system_external_id?: string; // Para GSI-3: "JIRA#JIRA-12345"
}

/**
 * Input para crear una nueva incidencia
 */
export interface CreateIncidentInput {
  external_id: string;
  source_system: SourceSystem;
  source_url?: string;
  title: string;
  description: string;
  category: string;
  severity: Severity;
  priority: Priority;
  status?: IncidentStatus;
  assigned_to?: string;
  team?: string;
  due_date?: string;
  affected_systems?: string[];
  environment?: Environment;
  error_message?: string;
  tags?: string[];
  attachments?: IncidentAttachment[];
}

/**
 * Input para actualizar el progreso de una incidencia
 */
export interface UpdateProgressInput {
  incident_id: string;
  developer: string;
  session_id?: string;
  workspace?: string;
  analysis?: ClineAnalysis;
  progress_notes?: string;
}

/**
 * Input para resolver una incidencia
 */
export interface ResolveIncidentInput {
  incident_id: string;
  resolved_by: string;
  resolution_type: ResolutionType;
  description: string;
  root_cause?: string;
  solution?: ClineSolution;
  preventive_actions?: string[];
}

/**
 * Input para cerrar una incidencia
 */
export interface CloseIncidentInput {
  incident_id: string;
  closed_by: string;
  notes?: string;
}

/**
 * Opciones para buscar incidencias
 */
export interface SearchIncidentsOptions {
  assigned_to?: string;
  status?: IncidentStatus;
  priority?: Priority;
  category?: string;
  limit?: number;
  last_evaluated_key?: {
    incident_id: string;
    sk: string;
  };
}

/**
 * Resultado de búsqueda de incidencias
 */
export interface SearchIncidentsResult {
  incidents: Incident[];
  last_evaluated_key?: {
    incident_id: string;
    sk: string;
  };
  count: number;
}

/**
 * Resumen de incidencia (para listados)
 */
export interface IncidentSummary {
  incident_id: string;
  external_id: string;
  title: string;
  status: IncidentStatus;
  severity: Severity;
  priority: Priority;
  assigned_to?: string;
  created_at: string;
  due_date?: string;
  category: string;
}

/**
 * Estadísticas de incidencias
 */
export interface IncidentStats {
  total: number;
  by_status: Record<IncidentStatus, number>;
  by_severity: Record<Severity, number>;
  by_priority: Record<Priority, number>;
  avg_resolution_time_minutes?: number;
}

/**
 * Configuración de la tabla DynamoDB
 */
export interface DynamoDBConfig {
  table_name: string;
  region: string;
  gsi_names: {
    assigned_status: string;
    status_priority: string;
    source_external: string;
  };
}

/**
 * Constantes para valores por defecto
 */
export const INCIDENT_CONSTANTS = {
  SK_METADATA: 'METADATA',
  DEFAULT_STATUS: 'NEW' as IncidentStatus,
  DEFAULT_PRIORITY: 'P3' as Priority,
  DEFAULT_SEVERITY: 'MEDIUM' as Severity,
} as const;

/**
 * Helper para generar ID de incidencia
 */
export function generateIncidentId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `INC-${timestamp}-${random}`;
}

/**
 * Helper para generar claves compuestas para GSIs
 */
export function generateGSIKeys(incident: Partial<Incident>): {
  status_priority_created?: string;
  priority_created?: string;
  source_system_external_id?: string;
} {
  const keys: ReturnType<typeof generateGSIKeys> = {};
  
  if (incident.status && incident.priority && incident.created_at) {
    keys.status_priority_created = `${incident.status}#${incident.priority}#${incident.created_at}`;
  }
  
  if (incident.priority && incident.created_at) {
    keys.priority_created = `${incident.priority}#${incident.created_at}`;
  }
  
  if (incident.source_system && incident.external_id) {
    keys.source_system_external_id = `${incident.source_system}#${incident.external_id}`;
  }
  
  return keys;
}

/**
 * Helper para validar una incidencia
 */
export function validateIncident(incident: Partial<Incident>): string[] {
  const errors: string[] = [];
  
  if (!incident.title || incident.title.trim().length === 0) {
    errors.push('Title is required');
  }
  
  if (!incident.description || incident.description.trim().length === 0) {
    errors.push('Description is required');
  }
  
  if (!incident.external_id || incident.external_id.trim().length === 0) {
    errors.push('External ID is required');
  }
  
  if (!incident.source_system) {
    errors.push('Source system is required');
  }
  
  if (!incident.category || incident.category.trim().length === 0) {
    errors.push('Category is required');
  }
  
  return errors;
}

/**
 * Helper para calcular tiempo de resolución
 */
export function calculateResolutionTime(incident: Incident): number | undefined {
  if (!incident.created_at || !incident.resolved_at) {
    return undefined;
  }
  
  const created = new Date(incident.created_at).getTime();
  const resolved = new Date(incident.resolved_at).getTime();
  return Math.round((resolved - created) / 1000 / 60); // minutos
}
