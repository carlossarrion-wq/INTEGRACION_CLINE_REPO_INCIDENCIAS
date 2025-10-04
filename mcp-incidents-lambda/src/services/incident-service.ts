/**
 * Incident Service - Gestión de incidencias en DynamoDB
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  Incident,
  CreateIncidentInput,
  UpdateProgressInput,
  ResolveIncidentInput,
  CloseIncidentInput,
  SearchIncidentsOptions,
  SearchIncidentsResult,
  IncidentSummary,
  INCIDENT_CONSTANTS,
  generateIncidentId,
  generateGSIKeys,
  validateIncident,
} from '../types/incident';
import { logger } from '../utils/logger';

export class IncidentService {
  private dynamodb: DynamoDBClient;
  private tableName: string;
  private gsiNames: {
    assignedStatus: string;
    statusPriority: string;
    sourceExternal: string;
  };

  constructor(
    tableName: string = process.env.INCIDENTS_TABLE || 'incidents',
    region: string = process.env.AWS_REGION || 'eu-west-1'
  ) {
    this.dynamodb = new DynamoDBClient({ region });
    this.tableName = tableName;
    this.gsiNames = {
      assignedStatus: 'GSI-1-assigned-status',
      statusPriority: 'GSI-2-status-priority',
      sourceExternal: 'GSI-3-source-external',
    };
  }

  /**
   * Crear una nueva incidencia
   */
  async createIncident(input: CreateIncidentInput): Promise<Incident> {
    logger.info('Creating new incident', { external_id: input.external_id });

    // Validar input
    const validationErrors = validateIncident(input);
    if (validationErrors.length > 0) {
      throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
    }

    // Verificar si ya existe
    const existing = await this.findByExternalId(
      input.source_system,
      input.external_id
    );
    if (existing) {
      logger.warn('Incident already exists', {
        incident_id: existing.incident_id,
        external_id: input.external_id,
      });
      throw new Error(
        `Incident with external_id ${input.external_id} already exists`
      );
    }

    const now = new Date().toISOString();
    const incident: Incident = {
      incident_id: generateIncidentId(),
      sk: INCIDENT_CONSTANTS.SK_METADATA,
      external_id: input.external_id,
      source_system: input.source_system,
      source_url: input.source_url,
      title: input.title,
      description: input.description,
      category: input.category,
      severity: input.severity,
      priority: input.priority,
      status: input.status || INCIDENT_CONSTANTS.DEFAULT_STATUS,
      assigned_to: input.assigned_to,
      assigned_at: input.assigned_to ? now : undefined,
      team: input.team,
      created_at: now,
      updated_at: now,
      due_date: input.due_date,
      affected_systems: input.affected_systems,
      environment: input.environment,
      error_message: input.error_message,
      tags: input.tags,
      attachments: input.attachments,
      last_sync_at: now,
      ...generateGSIKeys({
        status: input.status || INCIDENT_CONSTANTS.DEFAULT_STATUS,
        priority: input.priority,
        created_at: now,
        source_system: input.source_system,
        external_id: input.external_id,
      }),
    };

    await this.dynamodb.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(incident, { removeUndefinedValues: true }),
      })
    );

    logger.info('Incident created successfully', {
      incident_id: incident.incident_id,
    });

    return incident;
  }

  /**
   * Obtener una incidencia por ID
   */
  async getIncident(incidentId: string): Promise<Incident | null> {
    logger.info('Getting incident', { incident_id: incidentId });

    const response = await this.dynamodb.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          incident_id: incidentId,
          sk: INCIDENT_CONSTANTS.SK_METADATA,
        }),
      })
    );

    if (!response.Item) {
      logger.warn('Incident not found', { incident_id: incidentId });
      return null;
    }

    return unmarshall(response.Item) as Incident;
  }

  /**
   * Buscar incidencia por external_id
   */
  async findByExternalId(
    sourceSystem: string,
    externalId: string
  ): Promise<Incident | null> {
    logger.info('Finding incident by external_id', {
      source_system: sourceSystem,
      external_id: externalId,
    });

    const response = await this.dynamodb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.gsiNames.sourceExternal,
        KeyConditionExpression:
          'source_system_external_id = :key AND sk = :sk',
        ExpressionAttributeValues: marshall({
          ':key': `${sourceSystem}#${externalId}`,
          ':sk': INCIDENT_CONSTANTS.SK_METADATA,
        }),
        Limit: 1,
      })
    );

    if (!response.Items || response.Items.length === 0) {
      return null;
    }

    return unmarshall(response.Items[0]) as Incident;
  }

  /**
   * Buscar incidencias asignadas a un desarrollador
   */
  async searchMyIncidents(
    assignedTo: string,
    options: SearchIncidentsOptions = {}
  ): Promise<SearchIncidentsResult> {
    logger.info('Searching incidents for user', { assigned_to: assignedTo });

    const limit = options.limit || 20;
    let keyConditionExpression = 'assigned_to = :assigned';
    const expressionValues: Record<string, any> = {
      ':assigned': assignedTo,
    };

    // Si se especifica status, usar el sort key del GSI
    if (options.status) {
      keyConditionExpression += ' AND begins_with(status_priority_created, :status)';
      expressionValues[':status'] = `${options.status}#`;
    }

    const response = await this.dynamodb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.gsiNames.assignedStatus,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: marshall(expressionValues),
        Limit: limit,
        ExclusiveStartKey: options.last_evaluated_key
          ? marshall(options.last_evaluated_key)
          : undefined,
        ScanIndexForward: false, // Más recientes primero
      })
    );

    const incidents = (response.Items || []).map(
      (item) => unmarshall(item) as Incident
    );

    return {
      incidents,
      last_evaluated_key: response.LastEvaluatedKey
        ? (unmarshall(response.LastEvaluatedKey) as any)
        : undefined,
      count: incidents.length,
    };
  }

  /**
   * Buscar incidencias por estado
   */
  async searchByStatus(
    status: string,
    options: SearchIncidentsOptions = {}
  ): Promise<SearchIncidentsResult> {
    logger.info('Searching incidents by status', { status });

    const limit = options.limit || 50;
    let keyConditionExpression = '#status = :status';
    const expressionNames: Record<string, string> = {
      '#status': 'status',
    };
    const expressionValues: Record<string, any> = {
      ':status': status,
    };

    // Filtrar por prioridad si se especifica
    if (options.priority) {
      keyConditionExpression += ' AND begins_with(priority_created, :priority)';
      expressionValues[':priority'] = `${options.priority}#`;
    }

    const response = await this.dynamodb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.gsiNames.statusPriority,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: marshall(expressionValues),
        Limit: limit,
        ExclusiveStartKey: options.last_evaluated_key
          ? marshall(options.last_evaluated_key)
          : undefined,
        ScanIndexForward: false,
      })
    );

    const incidents = (response.Items || []).map(
      (item) => unmarshall(item) as Incident
    );

    return {
      incidents,
      last_evaluated_key: response.LastEvaluatedKey
        ? (unmarshall(response.LastEvaluatedKey) as any)
        : undefined,
      count: incidents.length,
    };
  }

  /**
   * Actualizar progreso de una incidencia
   */
  async updateProgress(input: UpdateProgressInput): Promise<Incident> {
    logger.info('Updating incident progress', {
      incident_id: input.incident_id,
    });

    const now = new Date().toISOString();
    const incident = await this.getIncident(input.incident_id);

    if (!incident) {
      throw new Error(`Incident ${input.incident_id} not found`);
    }

    // Preparar el trabajo de Cline
    const clineWork = {
      ...incident.cline_work,
      started_at: incident.cline_work?.started_at || now,
      last_updated: now,
      developer: input.developer,
      session_id: input.session_id,
      workspace: input.workspace,
      analysis: input.analysis || incident.cline_work?.analysis,
    };

    // Actualizar estado si no está en progreso
    const newStatus =
      incident.status === 'NEW' || incident.status === 'ASSIGNED'
        ? 'IN_PROGRESS'
        : incident.status;

    const updateExpression = `
      SET cline_work = :work,
          #status = :status,
          updated_at = :now,
          status_priority_created = :spc
    `;

    await this.dynamodb.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({
          incident_id: input.incident_id,
          sk: INCIDENT_CONSTANTS.SK_METADATA,
        }),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':work': clineWork,
          ':status': newStatus,
          ':now': now,
          ':spc': `${newStatus}#${incident.priority}#${incident.created_at}`,
        }),
      })
    );

    logger.info('Incident progress updated', { incident_id: input.incident_id });

    return this.getIncident(input.incident_id) as Promise<Incident>;
  }

  /**
   * Resolver una incidencia
   */
  async resolveIncident(input: ResolveIncidentInput): Promise<Incident> {
    logger.info('Resolving incident', { incident_id: input.incident_id });

    const now = new Date().toISOString();
    const incident = await this.getIncident(input.incident_id);

    if (!incident) {
      throw new Error(`Incident ${input.incident_id} not found`);
    }

    const resolution = {
      resolved_by: input.resolved_by,
      resolved_at: now,
      resolution_type: input.resolution_type,
      description: input.description,
      root_cause: input.root_cause,
      preventive_actions: input.preventive_actions,
    };

    // Actualizar cline_work si hay solución
    const clineWork = input.solution
      ? {
          ...incident.cline_work,
          solution: input.solution,
          last_updated: now,
        }
      : incident.cline_work;

    const updateExpression = `
      SET resolution = :resolution,
          #status = :status,
          resolved_at = :now,
          updated_at = :now,
          status_priority_created = :spc,
          cline_work = :work,
          kb_sync_status = :sync_status
    `;

    await this.dynamodb.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({
          incident_id: input.incident_id,
          sk: INCIDENT_CONSTANTS.SK_METADATA,
        }),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':resolution': resolution,
          ':status': 'RESOLVED',
          ':now': now,
          ':spc': `RESOLVED#${incident.priority}#${incident.created_at}`,
          ':work': clineWork,
          ':sync_status': {
            synced: false,
            sync_attempts: 0,
          },
        }),
      })
    );

    logger.info('Incident resolved', { incident_id: input.incident_id });

    return this.getIncident(input.incident_id) as Promise<Incident>;
  }

  /**
   * Cerrar una incidencia
   */
  async closeIncident(input: CloseIncidentInput): Promise<Incident> {
    logger.info('Closing incident', { incident_id: input.incident_id });

    const now = new Date().toISOString();
    const incident = await this.getIncident(input.incident_id);

    if (!incident) {
      throw new Error(`Incident ${input.incident_id} not found`);
    }

    if (incident.status !== 'RESOLVED') {
      throw new Error(
        `Incident must be RESOLVED before closing. Current status: ${incident.status}`
      );
    }

    const updateExpression = `
      SET #status = :status,
          updated_at = :now,
          status_priority_created = :spc,
          kb_sync_status = :sync_status
    `;

    await this.dynamodb.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({
          incident_id: input.incident_id,
          sk: INCIDENT_CONSTANTS.SK_METADATA,
        }),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':status': 'CLOSED',
          ':now': now,
          ':spc': `CLOSED#${incident.priority}#${incident.created_at}`,
          ':sync_status': {
            synced: false,
            sync_attempts: 0,
          },
        }),
      })
    );

    logger.info('Incident closed', { incident_id: input.incident_id });

    return this.getIncident(input.incident_id) as Promise<Incident>;
  }

  /**
   * Crear múltiples incidencias en batch
   */
  async batchCreateIncidents(
    inputs: CreateIncidentInput[]
  ): Promise<{ created: number; failed: number; errors: string[] }> {
    logger.info('Batch creating incidents', { count: inputs.length });

    const result = {
      created: 0,
      failed: 0,
      errors: [] as string[],
    };

    // DynamoDB BatchWriteItem tiene límite de 25 items
    const batchSize = 25;
    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const putRequests = [];

      for (const input of batch) {
        try {
          // Validar
          const validationErrors = validateIncident(input);
          if (validationErrors.length > 0) {
            result.failed++;
            result.errors.push(
              `${input.external_id}: ${validationErrors.join(', ')}`
            );
            continue;
          }

          const now = new Date().toISOString();
          const incident: Incident = {
            incident_id: generateIncidentId(),
            sk: INCIDENT_CONSTANTS.SK_METADATA,
            external_id: input.external_id,
            source_system: input.source_system,
            source_url: input.source_url,
            title: input.title,
            description: input.description,
            category: input.category,
            severity: input.severity,
            priority: input.priority,
            status: input.status || INCIDENT_CONSTANTS.DEFAULT_STATUS,
            assigned_to: input.assigned_to,
            assigned_at: input.assigned_to ? now : undefined,
            team: input.team,
            created_at: now,
            updated_at: now,
            due_date: input.due_date,
            affected_systems: input.affected_systems,
            environment: input.environment,
            error_message: input.error_message,
            tags: input.tags,
            attachments: input.attachments,
            last_sync_at: now,
            ...generateGSIKeys({
              status: input.status || INCIDENT_CONSTANTS.DEFAULT_STATUS,
              priority: input.priority,
              created_at: now,
              source_system: input.source_system,
              external_id: input.external_id,
            }),
          };

          putRequests.push({
            PutRequest: {
              Item: marshall(incident, { removeUndefinedValues: true }),
            },
          });
        } catch (error) {
          result.failed++;
          result.errors.push(
            `${input.external_id}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      if (putRequests.length > 0) {
        try {
          await this.dynamodb.send(
            new BatchWriteItemCommand({
              RequestItems: {
                [this.tableName]: putRequests,
              },
            })
          );
          result.created += putRequests.length;
        } catch (error) {
          result.failed += putRequests.length;
          result.errors.push(
            `Batch write failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    }

    logger.info('Batch create completed', result);
    return result;
  }

  /**
   * Convertir incidencia a resumen
   */
  toSummary(incident: Incident): IncidentSummary {
    return {
      incident_id: incident.incident_id,
      external_id: incident.external_id,
      title: incident.title,
      status: incident.status,
      severity: incident.severity,
      priority: incident.priority,
      assigned_to: incident.assigned_to,
      created_at: incident.created_at,
      due_date: incident.due_date,
      category: incident.category,
    };
  }
}
