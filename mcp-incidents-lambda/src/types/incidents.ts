/**
 * Incident Analysis Types
 */

export interface IncidentMetadata {
  incident_id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  reported_date: string;
  resolved_date?: string;
  resolution_time_minutes?: number;
  root_cause: string;
  resolution: string;
  resolution_steps?: string[];
  tags?: string[];
  attachments_metadata?: AttachmentMetadata[];
  source_system?: string;
  source_id?: string;
}

export interface AttachmentMetadata {
  file_name: string;
  file_type: string;
  description: string;
  summary: string;
  s3_path: string;
  size_bytes: number;
}

export interface SimilarIncident {
  incident_id: string;
  title: string;
  description: string;
  similarity_score: number;
  resolution: string;
  resolution_time_minutes: number;
  root_cause?: string;
  category?: string;
  severity?: string;
}

export interface IncidentAnalysisResult {
  diagnosis: string;
  root_cause: string;
  recommended_actions: string[];
  confidence_score: number;
  similar_incidents: SimilarIncident[];
  original_query?: string;
  optimized_query?: string;
  metadata: {
    processing_time_ms: number;
    kb_query_time_ms: number;
    llm_analysis_time_ms: number;
    total_tokens: number;
  };
}

export interface KnowledgeBaseResult {
  content: string;
  score: number;
  metadata: Record<string, any>;
  location?: {
    type: string;
    s3Location?: {
      uri: string;
    };
  };
}

export interface LLMAnalysis {
  diagnosis: string;
  rootCause: string;
  recommendedActions: string[];
  confidenceScore: number;
  reasoning: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface SearchIncidentsInput {
  incident_description: string;
  optimize_query?: boolean;
  max_results?: number;
}
