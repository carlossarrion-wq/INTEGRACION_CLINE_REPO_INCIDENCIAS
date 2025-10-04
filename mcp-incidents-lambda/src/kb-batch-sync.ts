/**
 * Lambda Function: KB Batch Sync
 * 
 * Sincroniza incidencias cerradas desde DynamoDB hacia Knowledge Base
 * a través de S3. Se ejecuta cada hora mediante EventBridge.
 */

import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from './utils/logger.js';
import { Incident } from './types/incident.js';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });
const cloudwatch = new CloudWatchClient({ region: process.env.AWS_REGION });

const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE || 'incidents';
const S3_BUCKET = process.env.S3_BUCKET || 'incident-analyzer-dev-incidents-dev';
const S3_PREFIX = process.env.S3_PREFIX || 'incidents/closed/';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50');
const MAX_SYNC_ATTEMPTS = parseInt(process.env.MAX_SYNC_ATTEMPTS || '3');

interface SyncResult {
  total_found: number;
  successfully_synced: number;
  failed: number;
  skipped: number;
  errors: Array<{ incident_id: string; error: string }>;
  duration_ms: number;
}

interface KBDocument {
  incident_id: string;
  external_id: string;
  source_system: string;
  source_url?: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  priority: string;
  affected_systems: string[];
  environment?: string;
  error_message?: string;
  root_cause: string;
  resolution: string;
  resolution_type?: string;
  resolution_steps: string[];
  code_changes: Array<{
    file: string;
    description: string;
    diff?: string;
  }>;
  resolved_by?: string;
  resolved_at?: string;
  resolution_time_minutes?: number;
  tags: string[];
  synced_to_kb_at: string;
}

/**
 * Handler principal de la Lambda
 */
export async function handler(): Promise<SyncResult> {
  logger.info('Starting batch sync of closed incidents to KB');
  
  const startTime = Date.now();
  const result: SyncResult = {
    total_found: 0,
    successfully_synced: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0
  };

  try {
    // 1. Buscar incidencias cerradas no sincronizadas
    const incidents = await findUnsyncedClosedIncidents();
    result.total_found = incidents.length;
    
    logger.info(`Found ${incidents.length} unsynced closed incidents`);

    if (incidents.length === 0) {
      logger.info('No incidents to sync');
      result.duration_ms = Date.now() - startTime;
      await publishMetrics(result);
      return result;
    }

    // 2. Procesar cada incidencia
    for (const incident of incidents) {
      try {
        // Verificar si ha excedido intentos máximos
        const syncAttempts = incident.kb_sync_status?.sync_attempts || 0;
        if (syncAttempts >= MAX_SYNC_ATTEMPTS) {
          logger.warn(`Skipping incident ${incident.incident_id} - exceeded max sync attempts (${syncAttempts})`);
          result.skipped++;
          continue;
        }

        await syncIncidentToKB(incident);
        result.successfully_synced++;
        
        logger.info(`Successfully synced incident ${incident.incident_id}`);
      } catch (error) {
        result.failed++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push({
          incident_id: incident.incident_id,
          error: errorMessage
        });
        
        logger.error(`Failed to sync incident ${incident.incident_id}:`, error);
        
        // Actualizar contador de intentos fallidos
        await updateSyncStatus(incident.incident_id, false, errorMessage);
      }
    }

    result.duration_ms = Date.now() - startTime;
    
    logger.info('Batch sync completed', result);

    // 3. Publicar métricas a CloudWatch
    await publishMetrics(result);

    return result;
  } catch (error) {
    logger.error('Batch sync failed:', error);
    result.duration_ms = Date.now() - startTime;
    await publishMetrics(result);
    throw error;
  }
}

/**
 * Busca incidencias cerradas que no han sido sincronizadas
 */
async function findUnsyncedClosedIncidents(): Promise<Incident[]> {
  const incidents: Incident[] = [];
  
  try {
    // Query usando GSI-2 (status-priority index)
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

    logger.info(`Query returned ${incidents.length} incidents`);
  } catch (error) {
    logger.error('Error querying unsynced incidents:', error);
    throw error;
  }

  return incidents;
}

/**
 * Sincroniza una incidencia a la Knowledge Base vía S3
 */
async function syncIncidentToKB(incident: Incident): Promise<void> {
  // Transformar a formato optimizado para KB
  const kbDocument: KBDocument = {
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
  
  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(kbDocument, null, 2),
      ContentType: 'application/json',
      Metadata: {
        'incident-id': incident.incident_id,
        'synced-at': new Date().toISOString(),
        'source': 'batch-sync',
        'status': 'closed',
        'category': incident.category,
        'severity': incident.severity
      }
    }));

    logger.info(`Incident saved to S3`, {
      incident_id: incident.incident_id,
      s3_key: s3Key,
      bucket: S3_BUCKET
    });

    // Actualizar estado de sincronización en DynamoDB
    await updateSyncStatus(incident.incident_id, true);
  } catch (error) {
    logger.error(`Error saving to S3:`, error);
    throw error;
  }
}

/**
 * Actualiza el estado de sincronización en DynamoDB
 */
async function updateSyncStatus(
  incidentId: string,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  const now = new Date().toISOString();
  
  try {
    if (success) {
      // Sincronización exitosa
      await dynamodb.send(new UpdateItemCommand({
        TableName: INCIDENTS_TABLE,
        Key: marshall({
          incident_id: incidentId,
          sk: 'METADATA'
        }),
        UpdateExpression: 'SET kb_sync_status = :sync_status',
        ExpressionAttributeValues: marshall({
          ':sync_status': {
            synced: true,
            synced_at: now,
            sync_attempts: 0
          }
        })
      }));

      logger.info(`Updated sync status to success`, { incident_id: incidentId });
    } else {
      // Sincronización fallida - incrementar contador
      await dynamodb.send(new UpdateItemCommand({
        TableName: INCIDENTS_TABLE,
        Key: marshall({
          incident_id: incidentId,
          sk: 'METADATA'
        }),
        UpdateExpression: `
          SET kb_sync_status.sync_attempts = if_not_exists(kb_sync_status.sync_attempts, :zero) + :one,
              kb_sync_status.last_sync_attempt = :now,
              kb_sync_status.last_sync_error = :error,
              kb_sync_status.synced = :false
        `,
        ExpressionAttributeValues: marshall({
          ':zero': 0,
          ':one': 1,
          ':now': now,
          ':error': errorMessage || 'Unknown error',
          ':false': false
        })
      }));

      logger.warn(`Updated sync status to failed`, {
        incident_id: incidentId,
        error: errorMessage
      });
    }
  } catch (error) {
    logger.error(`Error updating sync status:`, error);
    // No lanzar error aquí para no interrumpir el batch
  }
}

/**
 * Calcula el tiempo de resolución en minutos
 */
function calculateResolutionTime(incident: Incident): number | undefined {
  if (!incident.created_at || !incident.resolved_at) {
    return undefined;
  }
  
  try {
    const created = new Date(incident.created_at).getTime();
    const resolved = new Date(incident.resolved_at).getTime();
    return Math.round((resolved - created) / 1000 / 60); // minutos
  } catch (error) {
    logger.warn('Error calculating resolution time', { incident_id: incident.incident_id });
    return undefined;
  }
}

/**
 * Publica métricas a CloudWatch
 */
async function publishMetrics(result: SyncResult): Promise<void> {
  try {
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'IncidentManagement/KBSync',
      MetricData: [
        {
          MetricName: 'IncidentsFound',
          Value: result.total_found,
          Unit: 'Count',
          Timestamp: new Date()
        },
        {
          MetricName: 'IncidentsSynced',
          Value: result.successfully_synced,
          Unit: 'Count',
          Timestamp: new Date()
        },
        {
          MetricName: 'SyncErrors',
          Value: result.failed,
          Unit: 'Count',
          Timestamp: new Date()
        },
        {
          MetricName: 'IncidentsSkipped',
          Value: result.skipped,
          Unit: 'Count',
          Timestamp: new Date()
        },
        {
          MetricName: 'SyncDuration',
          Value: result.duration_ms,
          Unit: 'Milliseconds',
          Timestamp: new Date()
        }
      ]
    }));

    logger.info('Metrics published to CloudWatch');
  } catch (error) {
    logger.error('Error publishing metrics:', error);
    // No lanzar error para no interrumpir el flujo principal
  }
}
