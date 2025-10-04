/**
 * Tool: sync_and_ingest
 * 
 * Workflow completo: Sincroniza incidencias cerradas a S3 y luego
 * inicia el ingestion job en la Knowledge Base para que estén
 * disponibles inmediatamente en búsquedas.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import { logger } from '../utils/logger.js';

const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'eu-west-1' });
const bedrockAgent = new BedrockAgentClient({ region: process.env.AWS_REGION || 'eu-west-1' });

interface SyncAndIngestInput {
  wait_for_sync?: boolean;
  knowledge_base_id?: string;
  data_source_id?: string;
}

interface SyncResult {
  total_found: number;
  successfully_synced: number;
  failed: number;
  skipped: number;
  errors: Array<{ incident_id: string; error: string }>;
  duration_ms: number;
}

interface SyncAndIngestResult {
  status: 'success' | 'partial_success' | 'error';
  message: string;
  sync_result?: SyncResult;
  ingestion_job_id?: string;
  ingestion_status?: string;
  errors?: string[];
}

/**
 * Ejecuta el workflow completo de sincronización e ingestion
 */
export async function syncAndIngest(input: SyncAndIngestInput): Promise<SyncAndIngestResult> {
  const errors: string[] = [];
  const knowledgeBaseId = input.knowledge_base_id || process.env.KB_ID || 'LPR1PEW0LN';
  const dataSourceId = input.data_source_id || 'AJIJE6BWIV';
  
  try {
    // Paso 1: Sincronizar incidencias a S3
    logger.info('Step 1: Syncing incidents to S3...');
    
    const syncCommand = new InvokeCommand({
      FunctionName: process.env.KB_SYNC_FUNCTION_NAME || 'incident-kb-batch-sync',
      InvocationType: input.wait_for_sync !== false ? 'RequestResponse' : 'Event'
    });

    const syncResponse = await lambda.send(syncCommand);
    let syncResult: SyncResult | undefined;

    if (input.wait_for_sync !== false && syncResponse.Payload) {
      const payload = JSON.parse(new TextDecoder().decode(syncResponse.Payload));
      
      if (syncResponse.FunctionError) {
        errors.push(`Sync failed: ${payload.errorMessage || 'Unknown error'}`);
        return {
          status: 'error',
          message: 'La sincronización a S3 falló',
          errors
        };
      }

      syncResult = payload as SyncResult;
      logger.info('Sync completed', syncResult);

      if (syncResult.successfully_synced === 0) {
        return {
          status: 'success',
          message: 'No hay incidencias nuevas para sincronizar',
          sync_result: syncResult
        };
      }
    }

    // Paso 2: Iniciar ingestion job en KB
    logger.info('Step 2: Starting KB ingestion job...');
    
    const ingestionCommand = new StartIngestionJobCommand({
      knowledgeBaseId: knowledgeBaseId,
      dataSourceId: dataSourceId,
      description: `Auto-triggered after syncing ${syncResult?.successfully_synced || 'new'} incidents`
    });

    const ingestionResponse = await bedrockAgent.send(ingestionCommand);

    if (!ingestionResponse.ingestionJob) {
      errors.push('No ingestion job returned from API');
      return {
        status: 'partial_success',
        message: 'Incidencias sincronizadas a S3 pero falló el inicio del ingestion job',
        sync_result: syncResult,
        errors
      };
    }

    const job = ingestionResponse.ingestionJob;

    return {
      status: 'success',
      message: `✅ Workflow completado: ${syncResult?.successfully_synced || 'N/A'} incidencias sincronizadas a S3 y ingestion job iniciado (${job.status}). Las incidencias estarán disponibles en búsquedas en ~2-5 minutos.`,
      sync_result: syncResult,
      ingestion_job_id: job.ingestionJobId,
      ingestion_status: job.status
    };

  } catch (error) {
    logger.error('Error in sync and ingest workflow', error);
    
    return {
      status: 'error',
      message: 'Error en el workflow de sincronización e ingestion',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    };
  }
}

/**
 * Tool definition para MCP
 */
export const syncAndIngestTool = {
  name: 'sync_and_ingest',
  description: 'Ejecuta el workflow completo: (1) Sincroniza incidencias cerradas de DynamoDB a S3, y (2) Inicia el ingestion job en la Knowledge Base para que las incidencias estén disponibles inmediatamente en búsquedas. ' +
    'Este es el método recomendado para forzar la sincronización completa end-to-end.',
  inputSchema: {
    type: 'object',
    properties: {
      wait_for_sync: {
        type: 'boolean',
        description: 'Si true, espera a que termine la sincronización a S3 antes de iniciar el ingestion. Por defecto: true',
        default: true
      },
      knowledge_base_id: {
        type: 'string',
        description: 'ID de la Knowledge Base (opcional, usa LPR1PEW0LN por defecto)'
      },
      data_source_id: {
        type: 'string',
        description: 'ID del data source (opcional, usa AJIJE6BWIV por defecto)'
      }
    }
  }
};
