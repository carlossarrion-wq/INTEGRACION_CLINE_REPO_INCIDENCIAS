#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Desplegando MCP Incidents Server...${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}📋 Verificando prerequisitos...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js no está instalado${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm no está instalado${NC}"
    exit 1
fi

if ! command -v sam &> /dev/null; then
    echo -e "${RED}❌ AWS SAM CLI no está instalado${NC}"
    echo "Instalar con: brew install aws-sam-cli"
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI no está instalado${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Todos los prerequisitos están instalados${NC}"
echo ""

# Get AWS account info
echo -e "${YELLOW}🔍 Verificando credenciales AWS...${NC}"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo -e "${RED}❌ No se pudieron obtener las credenciales AWS${NC}"
    echo "Ejecuta: aws configure"
    exit 1
fi

AWS_REGION=$(aws configure get region || echo "eu-west-1")
echo -e "${GREEN}✓ AWS Account: ${AWS_ACCOUNT_ID}${NC}"
echo -e "${GREEN}✓ AWS Region: ${AWS_REGION}${NC}"
echo ""

# Install dependencies
echo -e "${YELLOW}📦 Instalando dependencias...${NC}"
npm install
echo -e "${GREEN}✓ Dependencias instaladas${NC}"
echo ""

# Build TypeScript
echo -e "${YELLOW}🔨 Compilando TypeScript...${NC}"
npm run build
echo -e "${GREEN}✓ Compilación completada${NC}"
echo ""

# Package Lambda
echo -e "${YELLOW}📦 Empaquetando Lambda...${NC}"
cd dist
zip -r ../deployment.zip . > /dev/null
cd ..
echo -e "${GREEN}✓ Lambda empaquetado${NC}"
echo ""

# Deploy with SAM
echo -e "${YELLOW}☁️  Desplegando a AWS con SAM...${NC}"
sam deploy \
  --template-file infrastructure/template.yaml \
  --stack-name mcp-incidents-server \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region ${AWS_REGION} \
  --resolve-s3 \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Error en el despliegue${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Despliegue completado${NC}"
echo ""

# Get outputs
echo -e "${YELLOW}📍 Obteniendo información del despliegue...${NC}"
FUNCTION_URL=$(aws cloudformation describe-stacks \
  --stack-name mcp-incidents-server \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`MCPServerUrl`].OutputValue' \
  --output text)

FUNCTION_ARN=$(aws cloudformation describe-stacks \
  --stack-name mcp-incidents-server \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`MCPServerArn`].OutputValue' \
  --output text)

GROUP_NAME=$(aws cloudformation describe-stacks \
  --stack-name mcp-incidents-server \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`MCPUsersGroupName`].OutputValue' \
  --output text)

echo ""
echo -e "${GREEN}✅ ¡Despliegue completado exitosamente!${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}📍 MCP Server URL:${NC}"
echo "   ${FUNCTION_URL}"
echo ""
echo -e "${GREEN}🔧 Configuración para Cline:${NC}"
echo ""
echo "Añade esto a tu configuración de Cline:"
echo ""
echo '{'
echo '  "mcpServers": {'
echo '    "incidents-analyzer": {'
echo "      \"url\": \"${FUNCTION_URL}\","
echo '      "transport": "sse",'
echo '      "auth": {'
echo '        "type": "aws-iam",'
echo "        \"region\": \"${AWS_REGION}\""
echo '      }'
echo '    }'
echo '  }'
echo '}'
echo ""
echo -e "${GREEN}👥 Añadir usuarios al grupo IAM:${NC}"
echo "   aws iam add-user-to-group --group-name ${GROUP_NAME} --user-name TU_USUARIO"
echo ""
echo -e "${GREEN}📊 Ver logs:${NC}"
echo "   aws logs tail /aws/lambda/mcp-incidents-server --follow"
echo ""
echo -e "${GREEN}🧪 Probar el servidor:${NC}"
echo "   curl -X POST ${FUNCTION_URL} \\"
echo '     -H "Content-Type: application/json" \\'
echo '     --aws-sigv4 "aws:amz:'"${AWS_REGION}"':lambda" \\'
echo '     -d '"'"'{"jsonrpc":"2.0","method":"tools/list","id":1}'"'"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
