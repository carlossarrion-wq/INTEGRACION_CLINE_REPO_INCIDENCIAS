/**
 * AWS Lambda Handler for MCP Server
 * Supports both direct Lambda invocation and Function URL requests with AWS IAM authentication
 */

import { Context } from 'aws-lambda';
import { MCPServer } from './mcp-server';
import { SearchSimilarIncidentsTool } from './tools/search-similar-incidents';
import { MCPRequest } from './types/mcp';
import { logger } from './utils/logger';

// Initialize MCP Server (singleton)
let mcpServer: MCPServer | null = null;

function getMCPServer(): MCPServer {
  if (!mcpServer) {
    mcpServer = new MCPServer({
      name: 'incidents-analyzer',
      version: '1.0.0',
      tools: [new SearchSimilarIncidentsTool()],
    });
  }
  return mcpServer;
}

export const handler = async (
  event: any,
  context: Context
): Promise<any> => {
  const requestId = context.awsRequestId;
  logger.info('Lambda invocation started', { requestId, awsRequestId: context.awsRequestId });

  // Detect invocation type: direct invoke vs Function URL
  const isDirectInvoke = !event.requestContext;

  try {
    
    let userArn = 'local-mcp-server';
    let userId = 'local-mcp-server';
    let accountId = context.invokedFunctionArn?.split(':')[4] || 'unknown';

    if (isDirectInvoke) {
      // Direct Lambda invocation from local MCP server
      logger.info('Direct Lambda invocation detected', { requestId });
    } else {
      // Function URL invocation (HTTP)
      // Check for custom header authentication (for Cline)
      const customAccessKey = event.headers?.['x-aws-access-key-id'];
      const customSecretKey = event.headers?.['x-aws-secret-access-key'];

      if (customAccessKey && customSecretKey) {
        // Validate credentials using AWS STS
        try {
          const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
          const stsClient = new STSClient({
            region: process.env.BEDROCK_REGION || 'eu-west-1',
            credentials: {
              accessKeyId: customAccessKey,
              secretAccessKey: customSecretKey,
            },
          });

          const identity = await stsClient.send(new GetCallerIdentityCommand({}));
          userArn = identity.Arn || 'unknown';
          userId = identity.UserId || 'unknown';
          accountId = identity.Account || 'unknown';

          logger.info('Authenticated via custom headers', { userArn, userId, accountId });
        } catch (error) {
          logger.error('Invalid AWS credentials in headers', error);
          return {
            statusCode: 403,
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              error: 'Unauthorized',
              message: 'Invalid AWS credentials',
            }),
          };
        }
      } else if ((event.requestContext as any).authorizer?.iam) {
        // Standard IAM authentication via Function URL
        const authorizer = (event.requestContext as any).authorizer;
        userArn = authorizer.iam.userArn || 'unknown';
        userId = authorizer.iam.userId || 'unknown';
        accountId = authorizer.iam.accountId || 'unknown';
        logger.info('Authenticated via IAM Function URL', { userArn, userId, accountId });
      } else {
        // No authentication provided
        logger.warn('Unauthorized request - no authentication provided');
        return {
          statusCode: 403,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            error: 'Unauthorized',
            message: 'AWS authentication required (IAM or custom headers)',
          }),
        };
      }

      // Handle CORS preflight
      if (event.requestContext.http.method === 'OPTIONS') {
        return {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
          },
          body: '',
        };
      }
    }

    logger.info('Authenticated request', {
      userArn,
      userId,
      accountId,
      requestId,
      invocationType: isDirectInvoke ? 'direct' : 'http',
    });

    // Parse request body
    let mcpRequest: MCPRequest;
    try {
      if (isDirectInvoke) {
        // Direct invocation: event is the MCP request itself
        mcpRequest = event;
      } else {
        // HTTP invocation: parse body
        mcpRequest = JSON.parse(event.body || '{}');
      }
    } catch (error) {
      logger.error('Invalid JSON in request body', error);
      const errorResponse = {
        error: 'Bad Request',
        message: 'Invalid JSON in request body',
      };
      return isDirectInvoke ? errorResponse : {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(errorResponse),
      };
    }

    // Validate MCP request
    if (!mcpRequest.method) {
      logger.error('Missing method in MCP request');
      const errorResponse = {
        error: 'Bad Request',
        message: 'Missing method in MCP request',
      };
      return isDirectInvoke ? errorResponse : {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(errorResponse),
      };
    }

    // Get MCP server instance
    const server = getMCPServer();

    // Process MCP request
    const mcpResponse = await server.handleRequest(mcpRequest, {
      userArn,
      userId,
      requestId,
    });

    logger.info('MCP request processed successfully', {
      method: mcpRequest.method,
      requestId,
    });

    // Return response based on invocation type
    if (isDirectInvoke) {
      // Direct invocation: return MCP response directly
      return mcpResponse;
    } else {
      // HTTP invocation: wrap in API Gateway response
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(mcpResponse),
      };
    }
  } catch (error) {
    logger.error('Unhandled error in Lambda handler', error);

    const errorResponse = {
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      requestId: context.awsRequestId,
    };

    return isDirectInvoke ? errorResponse : {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(errorResponse),
    };
  }
};
