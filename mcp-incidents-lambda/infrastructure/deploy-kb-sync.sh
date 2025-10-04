#!/bin/bash

# Script de despliegue para Lambda de sincronización KB
# Despliega la función Lambda que sincroniza incidencias cerradas a Knowledge Base

set -e

echo "========================================="
echo "Deploying KB Batch Sync Lambda"
echo "========================================="

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuración
STACK_NAME="incident-kb-sync-stack"
TEMPLATE_FILE="infrastructure/kb-sync-template.yaml"
REGION="${AWS_REGION:-eu-west-1}"
INCIDENTS_TABLE="${INCIDENTS_TABLE:-incidents}"
S3_BUCKET="${S3_BUCKET:-incident-analyzer-dev-incidents-dev}"
KB_ID="${KB_ID:-LPR1PEW0LN}"
echo -e "${YELLOW}Configuration:${NC}"
echo "  Stack Name: $STACK_NAME"
echo "  Region: $REGION"
echo "  Incidents Table: $INCIDENTS_TABLE"
echo "  S3 Bucket: $S3_BUCKET"
echo "  Knowledge Base ID: $KB_ID"
echo "  Sync Schedule: cron(0 * * * ? *) [hardcoded in template]"
echo ""

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must run from mcp-incidents-lambda directory${NC}"
    exit 1
fi

# Paso 1: Compilar TypeScript
echo -e "${YELLOW}Step 1: Building TypeScript...${NC}"
npm run build
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

# Paso 2: Verificar que el handler existe
if [ ! -f "dist/kb-batch-sync.js" ]; then
    echo -e "${RED}Error: kb-batch-sync.js not found in dist/${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Handler file found${NC}"

# Paso 3: Verificar credenciales AWS
echo -e "${YELLOW}Step 2: Verifying AWS credentials...${NC}"
aws sts get-caller-identity --region $REGION > /dev/null 2>&1
if [ $? -eq 0 ]; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    echo -e "${GREEN}✓ AWS credentials valid (Account: $ACCOUNT_ID)${NC}"
else
    echo -e "${RED}✗ AWS credentials not configured${NC}"
    exit 1
fi

# Paso 4: Verificar que la tabla DynamoDB existe
echo -e "${YELLOW}Step 3: Verifying DynamoDB table...${NC}"
aws dynamodb describe-table --table-name $INCIDENTS_TABLE --region $REGION > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ DynamoDB table exists${NC}"
else
    echo -e "${RED}✗ DynamoDB table '$INCIDENTS_TABLE' not found${NC}"
    exit 1
fi

# Paso 5: Verificar que el bucket S3 existe
echo -e "${YELLOW}Step 4: Verifying S3 bucket...${NC}"
aws s3 ls s3://$S3_BUCKET --region $REGION > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ S3 bucket exists${NC}"
else
    echo -e "${RED}✗ S3 bucket '$S3_BUCKET' not found${NC}"
    exit 1
fi

# Paso 6: Desplegar con SAM
echo -e "${YELLOW}Step 5: Deploying Lambda with SAM...${NC}"
sam deploy \
    --template-file $TEMPLATE_FILE \
    --stack-name $STACK_NAME \
    --region $REGION \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides "IncidentsTableName=$INCIDENTS_TABLE S3BucketName=$S3_BUCKET KnowledgeBaseId=$KB_ID" \
    --resolve-s3 \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Deployment successful${NC}"
else
    echo -e "${RED}✗ Deployment failed${NC}"
    exit 1
fi

# Paso 7: Obtener outputs del stack
echo ""
echo -e "${YELLOW}Step 6: Getting stack outputs...${NC}"
FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`KBBatchSyncFunctionName`].OutputValue' \
    --output text)

FUNCTION_ARN=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`KBBatchSyncFunctionArn`].OutputValue' \
    --output text)

DASHBOARD_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`DashboardURL`].OutputValue' \
    --output text)

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "Function Name: $FUNCTION_NAME"
echo "Function ARN: $FUNCTION_ARN"
echo "Dashboard: $DASHBOARD_URL"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Monitor the first execution in CloudWatch Logs"
echo "2. Check the dashboard for sync metrics"
echo "3. Verify incidents are being synced to S3"
echo ""
echo -e "${YELLOW}Manual Test:${NC}"
echo "aws lambda invoke --function-name $FUNCTION_NAME --region $REGION response.json"
echo ""
echo -e "${YELLOW}View Logs:${NC}"
echo "aws logs tail /aws/lambda/$FUNCTION_NAME --follow --region $REGION"
echo ""
