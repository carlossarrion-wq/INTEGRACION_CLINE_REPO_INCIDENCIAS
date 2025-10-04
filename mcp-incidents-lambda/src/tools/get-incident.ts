/**
 * MCP Tool: Get Incident Details
 * Obtiene los detalles completos de una incidencia por su ID
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { IncidentService } from '../services/incident-service.js';

export const getIncidentTool: Tool = {
  name: 'get_incident',
  description:
    'Obtiene los detalles completos de una incidencia por su ID. Incluye toda la información: descripción, estado, asignación, trabajo realizado desde Cline, resolución, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      incident_id: {
        type: 'string',
        description: 'ID único de la incidencia (ej: INC-1759575610487-WC5F2I)',
      },
    },
    required: ['incident_id'],
  },
};

export async function handleGetIncident(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const incident_id = args.incident_id as string;

    if (!incident_id) {
      throw new Error('incident_id es requerido');
    }

    const service = new IncidentService();
    const incident = await service.getIncident(incident_id);

    if (!incident) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                found: false,
                message: `Incidencia ${incident_id} no encontrada`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              found: true,
              incident,
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
