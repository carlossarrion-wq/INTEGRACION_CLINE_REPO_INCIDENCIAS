#!/bin/bash

# Script para desplegar la tabla DynamoDB de incidencias
# Uso: ./deploy-dynamodb.sh [stack-name] [region]

set -e

STACK_NAME="${1:-incidents-dynamodb}"
REGION="${2:-eu-west-1}"
TEMPLATE_FILE="dynamodb-table.yaml"

echo "=================================================="
echo "Desplegando tabla DynamoDB de incidencias"
echo "=================================================="
echo "Stack Name: $STACK_NAME"
echo "Region: $REGION"
echo "Template: $TEMPLATE_FILE"
echo "=================================================="
echo ""

# Verificar que el template existe
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "❌ Error: Template file $TEMPLATE_FILE not found"
    exit 1
fi

# Validar el template
echo "📋 Validando template..."
sam validate --template-file "$TEMPLATE_FILE" --region "$REGION"

if [ $? -ne 0 ]; then
    echo "❌ Template validation failed"
    exit 1
fi

echo "✅ Template válido"
echo ""

# Verificar si el stack ya existe
echo "🔍 Verificando si el stack ya existe..."
STACK_EXISTS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].StackName' \
    --output text 2>/dev/null || echo "")

if [ -n "$STACK_EXISTS" ]; then
    echo "⚠️  Stack $STACK_NAME ya existe. Se actualizará."
    ACTION="update"
else
    echo "✨ Stack $STACK_NAME no existe. Se creará."
    ACTION="create"
fi

echo ""

# Desplegar
echo "🚀 Desplegando stack..."
sam deploy \
    --template-file "$TEMPLATE_FILE" \
    --stack-name "$STACK_NAME" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "$REGION" \
    --no-fail-on-empty-changeset \
    --no-confirm-changeset

if [ $? -ne 0 ]; then
    echo "❌ Deployment failed"
    exit 1
fi

echo ""
echo "✅ Stack desplegado exitosamente"
echo ""

# Obtener outputs
echo "📊 Outputs del stack:"
echo "=================================================="
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
    --output table

echo ""
echo "=================================================="
echo "✅ Deployment completado"
echo "=================================================="
echo ""
echo "Tabla DynamoDB creada: incidents"
echo "Region: $REGION"
echo ""
echo "Próximos pasos:"
echo "1. Verificar la tabla en la consola de AWS"
echo "2. Poblar con datos de prueba (backfill)"
echo "3. Extender el servidor MCP para usar la tabla"
echo ""
