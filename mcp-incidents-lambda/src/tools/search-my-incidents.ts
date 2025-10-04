/**
 * MCP Tool: Search My Incidents
 * Busca incidencias asignadas al usuario actual
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { IncidentService } from '../services/incident-service.js';
import { IncidentStatus } from '../types/incident.js';

export const searchMyIncidentsTool: Tool = {
  name: 'search_my_incidents',
  description:
    'Busca incidencias asignadas a un usuario específico. Permite filtrar por estado y limitar el número de resultados. Útil para ver qué incidencias tiene asignadas un desarrollador.',
  inputSchema: {
    type: 'object',
    properties: {
      assigned_to: {
        type: 'string',
        description:
          'Email o identificador del usuario (ej: developer@company.com)',
      },
      status: {
        type: 'string',
        enum: ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
        description: 'Filtrar por estado específico (opcional)',
      },
      limit: {
        type: 'number',
        description: 'Número máximo de resultados (default: 20, max: 50)',
        minimum: 1,
        maximum: 50,
      },
    },
    required: ['assigned_to'],
  },
};

export async function handleSearchMyIncidents(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const assigned_to = args.assigned_to as string;
    const status = args.status as IncidentStatus | undefined;
    const limit = (args.limit as number) || 20;

    if (!assigned_to) {
      throw new Error('assigned_to es requerido');
    }

    const service = new IncidentService();
    const result = await service.searchMyIncidents(assigned_to, {
      status,
      limit: Math.min(limit, 50),
    });

    // Convertir a resúmenes para respuesta más ligera
    const summaries = result.incidents.map((inc) => service.toSummary(inc));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              incidents: summaries,
              count: result.count,
              filters: {
                assigned_to,
                status: status || 'ALL',
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
