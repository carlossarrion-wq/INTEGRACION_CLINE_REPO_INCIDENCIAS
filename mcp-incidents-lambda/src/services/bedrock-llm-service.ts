/**
 * Bedrock LLM Service
 * Handles interaction with Claude Sonnet 4.5 for incident analysis
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { KnowledgeBaseResult, LLMAnalysis } from '../types/incidents';
import { logger } from '../utils/logger';

export interface BedrockLLMConfig {
  modelId: string;
  region: string;
}

export class BedrockLLMService {
  private client: BedrockRuntimeClient;
  private modelId: string;

  constructor(config: BedrockLLMConfig) {
    this.client = new BedrockRuntimeClient({
      region: config.region,
    });
    this.modelId = config.modelId;
    logger.info(`BedrockLLMService initialized with model: ${config.modelId}`);
  }

  async analyzeIncident(params: {
    query: string;
    retrievedDocuments: KnowledgeBaseResult[];
  }): Promise<LLMAnalysis> {
    const startTime = Date.now();

    try {
      const prompt = this.buildAnalysisPrompt(params.query, params.retrievedDocuments);

      const input = {
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4096,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      };

      logger.debug('Invoking LLM for incident analysis');

      const command = new InvokeModelCommand(input);
      const response = await this.client.send(command);

      const responseBody = JSON.parse(
        new TextDecoder().decode(response.body)
      );

      const analysis = this.parseAnalysisResponse(responseBody);

      const duration = Date.now() - startTime;
      logger.info(`LLM analysis completed in ${duration}ms, tokens: ${analysis.usage.totalTokens}`);

      return analysis;
    } catch (error) {
      logger.error('Error analyzing incident with LLM', error);
      throw new Error(`LLM analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async optimizeQuery(query: string): Promise<string> {
    const startTime = Date.now();

    try {
      const prompt = `Eres un experto en optimización de consultas para búsqueda de incidencias técnicas.

Tu tarea es reformular la siguiente descripción de incidencia para que sea más efectiva en una búsqueda semántica en una base de conocimiento.

DESCRIPCIÓN ORIGINAL:
${query}

INSTRUCCIONES:
1. Identifica los conceptos técnicos clave
2. Extrae síntomas específicos
3. Reformula de manera clara y concisa
4. Incluye términos técnicos relevantes
5. Mantén el contexto importante

Responde SOLO con la consulta optimizada, sin explicaciones adicionales.`;

      const input = {
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 500,
          temperature: 0.3,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      };

      logger.debug('Optimizing query with LLM');

      const command = new InvokeModelCommand(input);
      const response = await this.client.send(command);

      const responseBody = JSON.parse(
        new TextDecoder().decode(response.body)
      );

      const optimizedQuery = responseBody.content[0].text.trim();

      const duration = Date.now() - startTime;
      logger.info(`Query optimization completed in ${duration}ms`);

      return optimizedQuery;
    } catch (error) {
      logger.error('Error optimizing query with LLM', error);
      // Si falla la optimización, devolver la consulta original
      logger.warn('Falling back to original query');
      return query;
    }
  }

  private buildAnalysisPrompt(query: string, documents: KnowledgeBaseResult[]): string {
    const documentsText = documents
      .map((doc, i) => {
        const metadata = doc.metadata as any;
        return `
### Incidencia Similar ${i + 1} (Similitud: ${(doc.score * 100).toFixed(1)}%)
**ID**: ${metadata.incident_id || 'N/A'}
**Título**: ${metadata.title || 'N/A'}
**Descripción**: ${doc.content}
**Causa Raíz**: ${metadata.root_cause || 'No especificada'}
**Resolución**: ${metadata.resolution || 'No especificada'}
**Tiempo de Resolución**: ${metadata.resolution_time_minutes || 'N/A'} minutos
**Categoría**: ${metadata.category || 'N/A'}
**Severidad**: ${metadata.severity || 'N/A'}
        `;
      })
      .join('\n');

    return `Eres un experto en análisis de incidencias técnicas. Analiza la siguiente incidencia y proporciona un diagnóstico detallado basándote en casos históricos similares.

# INCIDENCIA A ANALIZAR
${query}

# INCIDENCIAS SIMILARES DEL HISTÓRICO
${documentsText}

# INSTRUCCIONES
Basándote en las incidencias similares encontradas, proporciona:

1. **DIAGNÓSTICO**: Un análisis claro y detallado del problema
2. **CAUSA RAÍZ**: La causa raíz más probable basada en casos similares
3. **ACCIONES RECOMENDADAS**: Lista de pasos específicos y accionables para resolver el problema
4. **CONFIANZA**: Tu nivel de confianza en este análisis (0.0 a 1.0)

IMPORTANTE: Responde ÚNICAMENTE en formato JSON válido, sin texto adicional antes o después:

{
  "diagnosis": "Análisis detallado del problema...",
  "root_cause": "Causa raíz identificada...",
  "recommended_actions": [
    "Paso 1: Acción específica...",
    "Paso 2: Acción específica...",
    "Paso 3: Acción específica..."
  ],
  "confidence_score": 0.85,
  "reasoning": "Breve explicación de por qué tienes este nivel de confianza"
}`;
  }

  private parseAnalysisResponse(response: any): LLMAnalysis {
    const text = response.content[0].text;

    // Extraer JSON del texto
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No se pudo parsear la respuesta del LLM');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    return {
      diagnosis: analysis.diagnosis,
      rootCause: analysis.root_cause,
      recommendedActions: analysis.recommended_actions,
      confidenceScore: analysis.confidence_score,
      reasoning: analysis.reasoning,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }
}
