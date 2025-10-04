/**
 * MCP Tool: Resolve Incident
 * Marca una incidencia como resuelta con la solución implementada
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { IncidentService } from '../services/incident-service.js';
import { ResolutionType, ClineSolution } from '../types/incident.js';

export const resolveIncidentTool: Tool = {
  name: 'resolve_incident',
  description:
    'Marca una incidencia como RESUELTA con la solución implementada. Registra la causa raíz, descripción de la resolución, pasos realizados y acciones preventivas. Prepara la incidencia para sincronización con la Knowledge Base.',
  inputSchema: {
    type: 'object',
    properties: {
      incident_id: {
        type: 'string',
        description: 'ID único de la incidencia',
      },
      resolved_by: {
        type: 'string',
        description: 'Email o identificador del desarrollador que resolvió',
      },
      resolution_type: {
        type: 'string',
        enum: ['FIXED', 'WORKAROUND', 'NOT_REPRODUCIBLE'],
        description:
          'Tipo de resolución: FIXED (solucionado permanentemente), WORKAROUND (solución temporal), NOT_REPRODUCIBLE (no se pudo reproducir)',
      },
      description: {
        type: 'string',
        description: 'Descripción detallada de cómo se resolvió la incidencia',
      },
      root_cause: {
        type: 'string',
        description: 'Causa raíz del problema (opcional pero recomendado)',
      },
      solution: {
        type: 'object',
        description: 'Detalles de la solución implementada (opcional)',
        properties: {
          description: {
            type: 'string',
            description: 'Descripción de la solución',
          },
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Pasos realizados para resolver',
          },
          code_changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                file: { type: 'string' },
                description: { type: 'string' },
                diff: { type: 'string' },
              },
            },
            description: 'Cambios de código realizados',
          },
          commands_executed: {
            type: 'array',
            items: { type: 'string' },
            description: 'Comandos ejecutados',
          },
          tests_performed: {
            type: 'array',
            items: { type: 'string' },
            description: 'Pruebas realizadas',
          },
        },
      },
      preventive_actions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Acciones preventivas para evitar que vuelva a ocurrir',
      },
    },
    required: ['incident_id', 'resolved_by', 'resolution_type', 'description'],
  },
};

export async function handleResolveIncident(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const incident_id = args.incident_id as string;
    const resolved_by = args.resolved_by as string;
    const resolution_type = args.resolution_type as ResolutionType;
    const description = args.description as string;
    const root_cause = args.root_cause as string | undefined;
    const solution = args.solution as ClineSolution | undefined;
    const preventive_actions = args.preventive_actions as string[] | undefined;

    if (!incident_id || !resolved_by || !resolution_type || !description) {
      throw new Error('incident_id, resolved_by, resolution_type y description son requeridos');
    }

    const service = new IncidentService();
    const incident = await service.resolveIncident({
      incident_id,
      resolved_by,
      resolution_type,
      description,
      root_cause,
      solution,
      preventive_actions,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Incidencia resuelta exitosamente',
              incident: {
                incident_id: incident.incident_id,
                title: incident.title,
                status: incident.status,
                resolved_at: incident.resolved_at,
                resolution: incident.resolution,
                kb_sync_status: incident.kb_sync_status,
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
