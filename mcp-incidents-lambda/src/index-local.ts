#!/usr/bin/env node

/**
 * MCP Local Server for Incident Analysis
 * 
 * Este servidor MCP se ejecuta localmente y usa stdio transport.
 * Se conecta a la Lambda wrapper en AWS para acceder a Bedrock Knowledge Base.
 * 
 * Configuración en Cline:
 * {
 *   "mcpServers": {
 *     "incidents-analyzer": {
 *       "command": "node",
 *       "args": ["/ruta/completa/build/index-local.js"],
 *       "env": {
 *         "AWS_REGION": "eu-west-1",
 *         "LAMBDA_FUNCTION_NAME": "mcp-incidents-kb-wrapper"
 *       }
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// Import DynamoDB tools
import { getIncidentTool, handleGetIncident } from './tools/get-incident.js';
import { searchMyIncidentsTool, handleSearchMyIncidents } from './tools/search-my-incidents.js';
import { updateIncidentTool, handleUpdateIncident } from './tools/update-incident.js';
import { resolveIncidentTool, handleResolveIncident } from './tools/resolve-incident.js';
import { closeIncidentTool, handleCloseIncident } from './tools/close-incident.js';
import { forceKBSyncTool, forceKBSync } from './tools/force-kb-sync.js';
import { syncAndIngestTool, syncAndIngest } from './tools/sync-and-ingest.js';

// Configuración desde variables de entorno
const AWS_REGION = process.env.AWS_REGION || 'eu-west-1';
const LAMBDA_FUNCTION_NAME = process.env.LAMBDA_FUNCTION_NAME || 'mcp-incidents-kb-wrapper';

// Cliente Lambda con credenciales locales
const lambdaClient = new LambdaClient({
  region: AWS_REGION,
  // Las credenciales se toman automáticamente de ~/.aws/credentials
});

// Definición de la herramienta MCP
const SEARCH_TOOL: Tool = {
  name: 'search_similar_incidents',
  description: 'Busca incidencias similares en la base de conocimiento y proporciona diagnóstico, causa raíz y recomendaciones basadas en casos históricos. ' +
    'Útil para encontrar soluciones a problemas similares, patrones de errores, y mejores prácticas. ' +
    'La búsqueda utiliza embeddings para encontrar contenido relacionado semánticamente.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Descripción detallada de la incidencia a analizar',
      },
      optimize_query: {
        type: 'boolean',
        description: 'Si true, optimiza la consulta con IA antes de buscar (recomendado). Por defecto: true',
        default: true,
      },
      max_results: {
        type: 'number',
        description: 'Número máximo de incidencias similares a retornar (1-10). Por defecto: 5',
        minimum: 1,
        maximum: 10,
        default: 5,
      },
    },
    required: ['query'],
  },
};

/**
 * Invoca la Lambda wrapper para buscar incidencias similares
 */
async function searchSimilarIncidents(
  query: string, 
  optimizeQuery: boolean = true, 
  maxResults: number = 5
): Promise<any> {
  try {
    // Preparar payload para la Lambda
    const payload = {
      method: 'tools/call',
      params: {
        name: 'search_similar_incidents',
        arguments: {
          incident_description: query,
          optimize_query: optimizeQuery,
          max_results: maxResults,
        },
      },
    };

    // Invocar Lambda
    const command = new InvokeCommand({
      FunctionName: LAMBDA_FUNCTION_NAME,
      Payload: JSON.stringify(payload),
    });

    const response = await lambdaClient.send(command);

    // Decodificar respuesta
    const responsePayload = JSON.parse(
      new TextDecoder().decode(response.Payload)
    );

    // Verificar si hay error
    if (response.FunctionError) {
      throw new Error(`Lambda error: ${JSON.stringify(responsePayload)}`);
    }

    return responsePayload;
  } catch (error) {
    console.error('Error invoking Lambda:', error);
    throw error;
  }
}

/**
 * Inicializa y ejecuta el servidor MCP
 */
async function main() {
  console.error('Starting MCP Local Server for Incident Analysis...');
  console.error(`AWS Region: ${AWS_REGION}`);
  console.error(`Lambda Function: ${LAMBDA_FUNCTION_NAME}`);

  // Crear servidor MCP
  const server = new Server(
    {
      name: 'incidents-analyzer',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handler: Listar herramientas disponibles
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        SEARCH_TOOL,
        getIncidentTool,
        searchMyIncidentsTool,
        updateIncidentTool,
        resolveIncidentTool,
        closeIncidentTool,
        forceKBSyncTool,
        syncAndIngestTool,
      ],
    };
  });

  // Handler: Ejecutar herramienta
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Knowledge Base search tool (Lambda-based)
      if (name === 'search_similar_incidents') {
        const query = args?.query as string;
        const optimizeQuery = (args?.optimize_query as boolean) !== false;
        const maxResults = (args?.max_results as number) || 5;

        if (!query) {
          throw new Error('Query parameter is required');
        }

        console.error(`Searching for: "${query}"`);
        console.error(`Options: optimize=${optimizeQuery}, maxResults=${maxResults}`);

        const result = await searchSimilarIncidents(query, optimizeQuery, maxResults);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // DynamoDB incident management tools (direct access)
      if (name === 'get_incident') {
        console.error(`Getting incident: ${args?.incident_id}`);
        return await handleGetIncident(args || {});
      }

      if (name === 'search_my_incidents') {
        console.error(`Searching incidents for: ${args?.assigned_to}`);
        return await handleSearchMyIncidents(args || {});
      }

      if (name === 'update_incident') {
        console.error(`Updating incident: ${args?.incident_id}`);
        return await handleUpdateIncident(args || {});
      }

      if (name === 'resolve_incident') {
        console.error(`Resolving incident: ${args?.incident_id}`);
        return await handleResolveIncident(args || {});
      }

      if (name === 'close_incident') {
        console.error(`Closing incident: ${args?.incident_id}`);
        return await handleCloseIncident(args || {});
      }

      if (name === 'force_kb_sync') {
        console.error('Forcing KB sync...');
        const result = await forceKBSync(args || {});
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      if (name === 'sync_and_ingest') {
        console.error('Starting full sync and ingest workflow...');
        const result = await syncAndIngest(args || {});
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Tool execution error (${name}):`, errorMessage);

      return {
        content: [
          {
            type: 'text',
            text: `Error executing ${name}: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Conectar con stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MCP Local Server started successfully');
  console.error('Waiting for requests from Cline...');
}

// Ejecutar servidor
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
