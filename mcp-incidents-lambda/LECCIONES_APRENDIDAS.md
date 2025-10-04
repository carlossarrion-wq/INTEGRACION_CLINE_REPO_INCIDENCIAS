# Lecciones Aprendidas - Integración MCP con Bedrock Knowledge Base

## 📋 Resumen del Proyecto

Integración exitosa de Cline con AWS Bedrock Knowledge Base mediante un servidor MCP local que invoca una Lambda wrapper.

**Fecha de implementación:** Octubre 2025  
**Tiempo total:** ~4 horas de troubleshooting y ajustes  
**Estado:** ✅ Funcionando correctamente

## 🎯 Arquitectura Final

```
Cline (VS Code)
    ↓ stdio transport
Servidor MCP Local (Node.js)
    ↓ AWS SDK (Lambda.invoke)
Lambda Wrapper (eu-west-1)
    ↓ Bedrock Agent Runtime + Bedrock Runtime
Knowledge Base + Claude Sonnet 4.5
```

## 🔍 Hallazgos Clave

### 1. Inference Profiles vs Foundation Models

**Problema inicial:**
Intentamos usar el modelo foundation directamente: `anthropic.claude-sonnet-4-5-20250929-v1:0`

**Error encontrado:**
```
Invocation of model ID anthropic.claude-sonnet-4-5-20250929-v1:0 with on-demand 
throughput isn't supported. Retry your request with the ID or ARN of an inference 
profile that contains this model.
```

**Solución:**
Usar el inference profile: `eu.anthropic.claude-sonnet-4-5-20250929-v1:0`

**Lección aprendida:**
- Los modelos Claude Sonnet 4.5 **requieren** usar inference profiles
- No pueden ser invocados directamente como foundation models
- Los inference profiles proporcionan enrutamiento automático multi-región

### 2. Enrutamiento Multi-Región de Inference Profiles

**Problema:**
El inference profile `eu.anthropic.claude-sonnet-4-5-20250929-v1:0` enruta automáticamente a múltiples regiones:
- eu-north-1
- eu-west-1
- eu-west-3
- eu-south-1
- eu-south-2
- eu-central-1

**Error encontrado:**
```
User is not authorized to perform: bedrock:InvokeModel on resource: 
arn:aws:bedrock:eu-north-1::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0
```

A pesar de configurar `BEDROCK_REGION=eu-west-1`, el SDK invocaba el modelo en `eu-north-1`.

**Solución:**
Usar wildcards en los permisos IAM para cubrir todas las regiones:

```yaml
Resource:
  - 'arn:aws:bedrock:*::foundation-model/*'
  - !Sub 'arn:aws:bedrock:*:${AWS::AccountId}:inference-profile/*'
```

**Lección aprendida:**
- Los inference profiles ignoran la región del cliente SDK
- Enrutan automáticamente a la región más apropiada
- Los permisos IAM deben incluir wildcards para todas las regiones
- No intentar "forzar" una región específica con el inference profile

### 3. Configuración de Región en el SDK

**Configuración correcta implementada:**

```typescript
// En search-similar-incidents.ts
const region = process.env.BEDROCK_REGION || 'eu-west-1';

this.kbService = new BedrockKBService({
  knowledgeBaseId,
  region,
});

this.llmService = new BedrockLLMService({
  modelId,
  region,
});
```

```typescript
// En bedrock-llm-service.ts
constructor(config: BedrockLLMConfig) {
  this.client = new BedrockRuntimeClient({
    region: config.region,
  });
  this.modelId = config.modelId;
}
```

**Lección aprendida:**
- La configuración de región es correcta y necesaria
- El inference profile enruta independientemente de esta configuración
- Mantener la configuración de región para otros servicios (Knowledge Base)

### 4. Permisos IAM Correctos

**Evolución de permisos:**

❌ **Intento 1:** Permiso específico para un modelo
```yaml
Resource:
  - !Sub 'arn:aws:bedrock:${AWS::Region}::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0'
```

❌ **Intento 2:** Añadir inference profile en región específica
```yaml
Resource:
  - !Sub 'arn:aws:bedrock:${AWS::Region}::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0'
  - !Sub 'arn:aws:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/eu.anthropic.claude-sonnet-4-5-20250929-v1:0'
```

✅ **Solución final:** Wildcards multi-región
```yaml
Resource:
  - 'arn:aws:bedrock:*::foundation-model/*'
  - !Sub 'arn:aws:bedrock:*:${AWS::AccountId}:inference-profile/*'
```

**Lección aprendida:**
- Usar wildcards es la práctica recomendada para inference profiles
- Simplifica la gestión de permisos
- Permite que AWS maneje el enrutamiento óptimo
- Referencia: Proyecto CONSULTA_RAG_DOCUMENTACION usa el mismo patrón

### 5. Invocación Directa vs HTTP en Lambda

**Problema inicial:**
El handler Lambda esperaba eventos HTTP (API Gateway) pero recibía invocaciones directas del SDK.

**Error encontrado:**
```
Cannot read properties of undefined (reading 'authorizer')
```

**Solución:**
Detectar el tipo de invocación y manejar ambos casos:

```typescript
export const handler = async (event: any): Promise<any> => {
  const isDirectInvoke = !event.requestContext;
  
  if (isDirectInvoke) {
    // Invocación directa desde SDK
    const response = await mcpServer.handleRequest(event);
    return response; // Retornar directamente
  } else {
    // Invocación HTTP (Function URL)
    const body = JSON.parse(event.body || '{}');
    const response = await mcpServer.handleRequest(body);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
  }
};
```

**Lección aprendida:**
- Lambda puede recibir diferentes tipos de eventos
- Detectar el tipo de invocación al inicio del handler
- Adaptar la respuesta según el tipo de invocación

### 6. Mapeo de Parámetros MCP

**Problema:**
El servidor local enviaba `query` pero la herramienta esperaba `incident_description`.

**Error encontrado:**
```
Query is null or undefined
```

**Solución:**
Alinear los nombres de parámetros entre el servidor local y la herramienta:

```typescript
// Servidor local (index-local.ts)
const result = await lambdaClient.send(new InvokeCommand({
  FunctionName: functionName,
  Payload: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: {
        incident_description: args.query,  // Mapeo correcto
        optimize_query: args.optimize_query,
        max_results: args.max_results
      }
    },
    id: request.id
  })
}));
```

**Lección aprendida:**
- Verificar el schema de entrada de las herramientas
- Mapear correctamente los parámetros en el servidor local
- Usar nombres descriptivos y consistentes

## 📊 Métricas de Rendimiento

**Prueba exitosa con incidencia OAuth:**

```json
{
  "processing_time_ms": 23737,
  "kb_query_time_ms": 382,
  "llm_analysis_time_ms": 20566,
  "total_tokens": 3317
}
```

**Desglose:**
- ⚡ Búsqueda en Knowledge Base: 382ms (1.6%)
- 🤖 Análisis con Claude: 20,566ms (86.6%)
- 🔄 Overhead y procesamiento: 2,789ms (11.8%)

**Lección aprendida:**
- El cuello de botella es el análisis con Claude (esperado)
- La búsqueda vectorial es muy rápida
- Considerar caché para consultas repetidas

## 💰 Costos Reales

**Por consulta:**
- Lambda: ~$0.0003
- Bedrock KB: $0.001
- Claude 4.5: ~$0.009 (3,317 tokens)
- **Total:** ~$0.0103 por consulta

**Proyección mensual (500 consultas):**
- Lambda: $0.15
- Bedrock KB: $0.50
- Claude 4.5: $4.50
- CloudWatch: $0.25
- **Total:** ~$5.40/mes

**Lección aprendida:**
- Costos muy razonables para el valor proporcionado
- Claude es el componente más costoso (esperado)
- Optimizar número de tokens puede reducir costos

## 🛠️ Mejores Prácticas Identificadas

### 1. Configuración de Permisos IAM

✅ **Hacer:**
- Usar wildcards para inference profiles
- Incluir todas las regiones posibles
- Documentar por qué se usan wildcards

❌ **Evitar:**
- Permisos demasiado específicos para inference profiles
- Asumir que la región del cliente controla el enrutamiento
- Permisos excesivamente amplios sin justificación

### 2. Manejo de Errores

✅ **Hacer:**
- Logs detallados en cada capa
- Capturar y propagar errores con contexto
- Incluir información de debugging en desarrollo

❌ **Evitar:**
- Errores genéricos sin contexto
- Silenciar errores importantes
- Logs excesivos en producción

### 3. Testing

✅ **Hacer:**
- Probar con casos reales desde el inicio
- Verificar logs en CloudWatch
- Validar respuestas completas

❌ **Evitar:**
- Asumir que funciona sin probar
- Ignorar warnings en logs
- No verificar el flujo completo

## 🔄 Evolución de la Arquitectura

### Arquitectura Inicial (Descartada)
```
Cline → Servidor MCP Remoto (Lambda + Function URL) → Bedrock
```

**Problemas:**
- Complejidad en autenticación
- Necesidad de proxy local para AWS IAM Signature V4
- Credenciales expuestas en configuración

### Arquitectura Final (Implementada)
```
Cline → Servidor MCP Local → Lambda Wrapper → Bedrock
```

**Ventajas:**
- Credenciales AWS nunca salen de la máquina
- Autenticación IAM nativa
- Más simple y seguro
- Fácil de debuggear

## 📚 Referencias Útiles

### Documentación Consultada

1. **AWS Bedrock Inference Profiles:**
   - https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles.html
   - Explica el enrutamiento automático multi-región

2. **MCP Protocol Specification:**
   - https://spec.modelcontextprotocol.io/
   - Especificación completa del protocolo

3. **AWS SDK for JavaScript v3:**
   - https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/
   - Documentación del SDK usado

### Proyectos de Referencia

- **CONSULTA_RAG_DOCUMENTACION:** Proyecto similar que usa el mismo modelo y permisos IAM con wildcards

## 🎯 Recomendaciones Futuras

### Corto Plazo

1. **Implementar caché local**
   - Reducir costos para consultas repetidas
   - Mejorar tiempo de respuesta

2. **Añadir más herramientas**
   - `create_incident`: Crear nuevas incidencias
   - `update_incident`: Actualizar incidencias resueltas
   - `get_incident_stats`: Estadísticas de incidencias

3. **Métricas y monitoreo**
   - Dashboard de uso
   - Alertas proactivas
   - Análisis de costos

### Largo Plazo

1. **Optimización de costos**
   - Evaluar modelos más pequeños para tareas simples
   - Implementar estrategia de caché inteligente
   - Batch processing para múltiples consultas

2. **Mejoras de funcionalidad**
   - Búsqueda por categorías
   - Filtros avanzados
   - Integración con sistemas de tickets

3. **Escalabilidad**
   - Soporte multi-tenant
   - Rate limiting
   - Gestión de cuotas

## ✅ Checklist de Implementación

Para futuros proyectos similares:

- [ ] Verificar si el modelo requiere inference profile
- [ ] Configurar permisos IAM con wildcards para regiones
- [ ] Implementar detección de tipo de invocación en Lambda
- [ ] Mapear correctamente parámetros entre capas
- [ ] Probar con casos reales desde el inicio
- [ ] Documentar decisiones de arquitectura
- [ ] Configurar alarmas de CloudWatch
- [ ] Establecer presupuesto de costos
- [ ] Crear guías de troubleshooting
- [ ] Implementar logging estructurado

## 🎓 Conclusiones

1. **Los inference profiles son poderosos pero requieren comprensión:**
   - Enrutamiento automático multi-región
   - Permisos IAM con wildcards necesarios
   - No intentar controlar la región manualmente

2. **La arquitectura local es superior para este caso de uso:**
   - Más segura (credenciales locales)
   - Más simple (menos componentes)
   - Más fácil de debuggear

3. **La documentación y el troubleshooting son cruciales:**
   - Logs detallados salvaron horas de debugging
   - Documentar decisiones ayuda a futuros desarrolladores
   - Los errores son oportunidades de aprendizaje

4. **AWS Bedrock es una plataforma robusta:**
   - Knowledge Base funciona muy bien
   - Claude Sonnet 4.5 proporciona análisis de calidad
   - Costos razonables para el valor proporcionado

---

**Última actualización:** Octubre 2025  
**Autor:** Equipo de Desarrollo  
**Estado:** Documento vivo - actualizar con nuevos hallazgos
