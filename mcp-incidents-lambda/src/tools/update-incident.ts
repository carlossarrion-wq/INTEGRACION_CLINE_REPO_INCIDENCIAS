/**
 * MCP Tool: Update Incident
 * Actualiza el progreso y estado de una incidencia
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { IncidentService } from '../services/incident-service.js';
import { ClineAnalysis } from '../types/incident.js';

export const updateIncidentTool: Tool = {
  name: 'update_incident',
  description:
    'Actualiza el progreso de trabajo en una incidencia. Permite registrar análisis, diagnóstico y notas de progreso. Cambia automáticamente el estado a IN_PROGRESS si está en NEW o ASSIGNED.',
  inputSchema: {
    type: 'object',
    properties: {
      incident_id: {
        type: 'string',
        description: 'ID único de la incidencia',
      },
      developer: {
        type: 'string',
        description: 'Email o identificador del desarrollador',
      },
      session_id: {
        type: 'string',
        description: 'ID de la sesión de Cline (opcional)',
      },
      workspace: {
        type: 'string',
        description: 'Nombre del workspace/proyecto (opcional)',
      },
      analysis: {
        type: 'object',
        description: 'Análisis realizado (opcional)',
        properties: {
          root_cause: {
            type: 'string',
            description: 'Causa raíz identificada',
          },
          diagnosis: {
            type: 'string',
            description: 'Diagnóstico del problema',
          },
          similar_incidents_count: {
            type: 'number',
            description: 'Número de incidencias similares encontradas',
          },
        },
      },
      progress_notes: {
        type: 'string',
        description: 'Notas adicionales sobre el progreso',
      },
    },
    required: ['incident_id', 'developer'],
  },
};

export async function handleUpdateIncident(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const incident_id = args.incident_id as string;
    const developer = args.developer as string;
    const session_id = args.session_id as string | undefined;
    const workspace = args.workspace as string | undefined;
    const analysis = args.analysis as ClineAnalysis | undefined;
    const progress_notes = args.progress_notes as string | undefined;

    if (!incident_id || !developer) {
      throw new Error('incident_id y developer son requeridos');
    }

    const service = new IncidentService();
    const incident = await service.updateProgress({
      incident_id,
      developer,
      session_id,
      workspace,
      analysis,
      progress_notes,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Incidencia actualizada exitosamente',
              incident: {
                incident_id: incident.incident_id,
                title: incident.title,
                status: incident.status,
                updated_at: incident.updated_at,
                cline_work: incident.cline_work,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: errorMessage,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
