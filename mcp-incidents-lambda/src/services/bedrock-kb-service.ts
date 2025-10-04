/**
 * Bedrock Knowledge Base Service
 * Handles retrieval from Aurora PostgreSQL + pgvector via Bedrock KB API
 */

import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  RetrieveCommandInput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { KnowledgeBaseResult } from '../types/incidents';
import { logger } from '../utils/logger';

export interface BedrockKBConfig {
  knowledgeBaseId: string;
  region: string;
}

export class BedrockKBService {
  private client: BedrockAgentRuntimeClient;
  private knowledgeBaseId: string;

  constructor(config: BedrockKBConfig) {
    this.client = new BedrockAgentRuntimeClient({
      region: config.region,
    });
    this.knowledgeBaseId = config.knowledgeBaseId;
    logger.info(`BedrockKBService initialized with KB: ${config.knowledgeBaseId}`);
  }

  async retrieve(params: {
    query: string;
    maxResults: number;
  }): Promise<{ results: KnowledgeBaseResult[] }> {
    const startTime = Date.now();

    try {
      const input: RetrieveCommandInput = {
        knowledgeBaseId: this.knowledgeBaseId,
        retrievalQuery: {
          text: params.query,
        },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults: params.maxResults,
            overrideSearchType: 'HYBRID', // Búsqueda híbrida: vectorial + keywords
          },
        },
      };

      logger.debug('Retrieving from Knowledge Base', { query: params.query, maxResults: params.maxResults });

      const command = new RetrieveCommand(input);
      const response = await this.client.send(command);

      const results: KnowledgeBaseResult[] = response.retrievalResults?.map((result) => ({
        content: result.content?.text || '',
        score: result.score || 0,
        metadata: result.metadata || {},
        location: result.location ? {
          type: result.location.type || 'UNKNOWN',
          s3Location: result.location.s3Location ? {
            uri: result.location.s3Location.uri || ''
          } : undefined
        } : undefined,
      })) || [];

      const duration = Date.now() - startTime;
      logger.info(`KB retrieval completed in ${duration}ms, found ${results.length} results`);

      return { results };
    } catch (error) {
      logger.error('Error retrieving from Knowledge Base', error);
      throw new Error(`Knowledge Base retrieval failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
