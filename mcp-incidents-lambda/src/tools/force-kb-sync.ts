/**
 * Tool: force_kb_sync
 * 
 * Fuerza la sincronización inmediata de incidencias cerradas a la Knowledge Base
 * sin esperar al cron schedule.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { logger } from '../utils/logger.js';

const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'eu-west-1' });

interface ForceSyncInput {
  wait_for_completion?: boolean; // Si true, espera a que termine la ejecución
}

interface SyncResult {
  total_found: number;
  successfully_synced: number;
  failed: number;
  skipped: number;
  errors: Array<{ incident_id: string; error: string }>;
  duration_ms: number;
}

interface ForceSyncResult {
  status: 'success' | 'error';
  message: string;
  sync_result?: SyncResult;
  request_id?: string;
  error?: string;
}

/**
 * Fuerza la ejecución de la Lambda de sincronización
 */
export async function forceKBSync(input: ForceSyncInput): Promise<ForceSyncResult> {
  const functionName = process.env.KB_SYNC_FUNCTION_NAME || 'incident-kb-batch-sync';
  
  try {
    logger.info('Forcing KB sync execution', { function_name: functionName });

    const command = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: input.wait_for_completion ? 'RequestResponse' : 'Event',
      LogType: 'Tail'
    });

    const response = await lambda.send(command);

    if (input.wait_for_completion && response.Payload) {
      // Parsear el resultado
      const payload = JSON.parse(new TextDecoder().decode(response.Payload));
      
      if (response.FunctionError) {
        return {
          status: 'error',
          message: 'La sincronización falló',
          error: payload.errorMessage || 'Unknown error',
          request_id: response.$metadata.requestId
        };
      }

      const syncResult = payload as SyncResult;
      
      return {
        status: 'success',
        message: `Sincronización completada: ${syncResult.successfully_synced} incidencias sincronizadas, ${syncResult.failed} fallidas, ${syncResult.skipped} omitidas`,
        sync_result: syncResult,
        request_id: response.$metadata.requestId
      };
    } else {
      // Invocación asíncrona
      return {
        status: 'success',
        message: 'Sincronización iniciada en background. Revisa los logs de CloudWatch para ver el progreso.',
        request_id: response.$metadata.requestId
      };
    }
  } catch (error) {
    logger.error('Error forcing KB sync', error);
    
    return {
      status: 'error',
      message: 'Error al forzar la sincronización',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Tool definition para MCP
 */
export const forceKBSyncTool = {
  name: 'force_kb_sync',
  description: 'Fuerza la sincronización inmediata de incidencias cerradas a la Knowledge Base sin esperar al schedule automático. Útil para sincronizar incidencias recién cerradas o verificar el funcionamiento del sistema.',
  inputSchema: {
    type: 'object',
    properties: {
      wait_for_completion: {
        type: 'boolean',
        description: 'Si true, espera a que la sincronización termine y retorna los resultados. Si false, inicia la sincronización en background. Por defecto: true',
        default: true
      }
    }
  }
};
