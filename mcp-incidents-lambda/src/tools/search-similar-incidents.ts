/**
 * MCP Tool: search_similar_incidents
 * Busca incidencias similares y proporciona análisis completo
 */

import { MCPTool, MCPContext } from '../types/mcp';
import { BedrockKBService } from '../services/bedrock-kb-service';
import { BedrockLLMService } from '../services/bedrock-llm-service';
import {
  SearchIncidentsInput,
  IncidentAnalysisResult,
  SimilarIncident,
} from '../types/incidents';
import { logger } from '../utils/logger';

export class SearchSimilarIncidentsTool implements MCPTool {
  name = 'search_similar_incidents';
  description =
    'Busca incidencias similares en la base de conocimiento y proporciona diagnóstico, causa raíz y recomendaciones basadas en casos históricos';

  inputSchema = {
    type: 'object' as const,
    properties: {
      incident_description: {
        type: 'string',
        description: 'Descripción detallada de la incidencia a analizar',
      },
      optimize_query: {
        type: 'boolean',
        description:
          'Si true, optimiza la consulta con IA antes de buscar (recomendado)',
        default: true,
      },
      max_results: {
        type: 'number',
        description: 'Número máximo de incidencias similares a retornar',
        default: 5,
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['incident_description'],
  };

  private kbService: BedrockKBService;
  private llmService: BedrockLLMService;

  constructor() {
    const knowledgeBaseId = process.env.BEDROCK_KNOWLEDGE_BASE_ID;
    const modelId = process.env.BEDROCK_MODEL_ID;
    const region = process.env.BEDROCK_REGION || 'eu-west-1';

    if (!knowledgeBaseId) {
      throw new Error('BEDROCK_KNOWLEDGE_BASE_ID environment variable is required');
    }
    if (!modelId) {
      throw new Error('BEDROCK_MODEL_ID environment variable is required');
    }

    this.kbService = new BedrockKBService({
      knowledgeBaseId,
      region,
    });

    this.llmService = new BedrockLLMService({
      modelId,
      region,
    });

    logger.info('SearchSimilarIncidentsTool initialized');
  }

  async execute(
    args: SearchIncidentsInput,
    context: MCPContext
  ): Promise<IncidentAnalysisResult> {
    const startTime = Date.now();

    logger.info(`[${context.userId}] Searching for similar incidents`);
    logger.debug('Input arguments', args);

    let query = args.incident_description;
    let originalQuery: string | undefined;

    try {
      // Paso 1: Optimizar consulta si está habilitado
      if (args.optimize_query !== false) {
        const optimizeStart = Date.now();
        logger.info('Optimizing query with LLM');

        const optimized = await this.llmService.optimizeQuery(query);
        originalQuery = query;
        query = optimized;

        const optimizeDuration = Date.now() - optimizeStart;
        logger.info(`Query optimization completed in ${optimizeDuration}ms`);
        logger.debug('Optimized query', { original: originalQuery, optimized: query });
      }

      // Paso 2: Buscar en Knowledge Base
      const kbStart = Date.now();
      logger.info('Retrieving from Knowledge Base');

      const kbResults = await this.kbService.retrieve({
        query,
        maxResults: args.max_results || 5,
      });

      const kbTime = Date.now() - kbStart;
      logger.info(`KB retrieval completed in ${kbTime}ms, found ${kbResults.results.length} results`);

      // Paso 3: Analizar con LLM
      const llmStart = Date.now();
      logger.info('Analyzing incident with LLM');

      const analysis = await this.llmService.analyzeIncident({
        query,
        retrievedDocuments: kbResults.results,
      });

      const llmTime = Date.now() - llmStart;
      logger.info(`LLM analysis completed in ${llmTime}ms`);

      // Paso 4: Formatear respuesta
      const similarIncidents: SimilarIncident[] = kbResults.results.map((result) => {
        const metadata = result.metadata as any;
        return {
          incident_id: metadata.incident_id || 'N/A',
          title: metadata.title || 'Sin título',
          description: result.content,
          similarity_score: result.score,
          resolution: metadata.resolution || 'No especificada',
          resolution_time_minutes: metadata.resolution_time_minutes || 0,
          root_cause: metadata.root_cause,
          category: metadata.category,
          severity: metadata.severity,
        };
      });

      const totalTime = Date.now() - startTime;

      const response: IncidentAnalysisResult = {
        diagnosis: analysis.diagnosis,
        root_cause: analysis.rootCause,
        recommended_actions: analysis.recommendedActions,
        confidence_score: analysis.confidenceScore,
        similar_incidents: similarIncidents,
        ...(originalQuery && {
          original_query: originalQuery,
          optimized_query: query,
        }),
        metadata: {
          processing_time_ms: totalTime,
          kb_query_time_ms: kbTime,
          llm_analysis_time_ms: llmTime,
          total_tokens: analysis.usage.totalTokens,
        },
      };

      logger.info(`[${context.userId}] Search completed successfully in ${totalTime}ms`);
      logger.debug('Analysis result', {
        confidence: response.confidence_score,
        similarIncidentsCount: response.similar_incidents.length,
      });

      return response;
    } catch (error) {
      logger.error(`[${context.userId}] Error searching similar incidents`, error);
      throw new Error(
        `Failed to search similar incidents: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
