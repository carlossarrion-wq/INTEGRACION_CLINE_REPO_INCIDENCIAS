import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { IncidentService } from "../services/incident-service.js";
import { CloseIncidentInput } from "../types/incident.js";

export const closeIncidentTool: Tool = {
  name: "close_incident",
  description: "Cierra una incidencia que ha sido previamente resuelta. Solo se pueden cerrar incidencias en estado RESOLVED. Al cerrar, la incidencia queda marcada como CLOSED y lista para sincronización con la base de conocimiento.",
  inputSchema: {
    type: "object",
    properties: {
      incident_id: {
        type: "string",
        description: "ID único de la incidencia a cerrar (formato: INC-YYYYMMDD-XXXXX)"
      },
      closed_by: {
        type: "string",
        description: "Email del usuario que cierra la incidencia"
      },
      closure_notes: {
        type: "string",
        description: "Notas adicionales sobre el cierre de la incidencia (opcional)"
      }
    },
    required: ["incident_id", "closed_by"]
  }
};

export async function handleCloseIncident(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const input: CloseIncidentInput = {
      incident_id: args.incident_id as string,
      closed_by: args.closed_by as string,
      notes: args.closure_notes as string | undefined
    };

    // Validación básica
    if (!input.incident_id || !input.incident_id.startsWith("INC-")) {
      throw new Error("incident_id debe tener formato INC-YYYYMMDD-XXXXX");
    }

    if (!input.closed_by || !input.closed_by.includes("@")) {
      throw new Error("closed_by debe ser un email válido");
    }

    const incidentService = new IncidentService();
    const updatedIncident = await incidentService.closeIncident(input);

    const response = {
      success: true,
      message: "Incidencia cerrada exitosamente",
      incident: {
        incident_id: updatedIncident.incident_id,
        title: updatedIncident.title,
        status: updatedIncident.status,
        updated_at: updatedIncident.updated_at,
        kb_sync_status: updatedIncident.kb_sync_status
      }
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: false,
              error: errorMessage,
              hint: "Verifica que la incidencia existe y está en estado RESOLVED antes de cerrarla"
            },
            null,
            2
          )
        }
      ]
    };
  }
}
