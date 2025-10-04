# Plan de Pruebas Unitarias - MCP Incidents Server

## 🎯 Objetivo

Validar la funcionalidad básica del servidor MCP sin necesidad de AWS, usando solo 10 tests esenciales.

## 📋 Prerequisitos

```bash
cd mcp-incidents-lambda

# 1. Instalar dependencias
npm install

# 2. Instalar Jest y tipos
npm install --save-dev jest @types/jest ts-jest

# 3. Verificar que jest.config.js existe
ls jest.config.js
```

## 🧪 Los 10 Tests Esenciales

### Test 1: Inicialización del Servidor ✅
**Objetivo**: Verificar que el servidor MCP se crea correctamente  
**Valida**: Constructor, instancia del objeto

### Test 2: Respuesta a Initialize ✅
**Objetivo**: Validar respuesta al método `initialize`  
**Valida**: Formato JSON-RPC, información del servidor, versión del protocolo

### Test 3: Listar Herramientas ✅
**Objetivo**: Verificar que se listan todas las herramientas disponibles  
**Valida**: Método `tools/list`, estructura de herramientas, schemas

### Test 4: Ejecutar Herramienta Válida ✅
**Objetivo**: Probar ejecución exitosa de una herramienta  
**Valida**: Método `tools/call`, paso de parámetros, formato de respuesta

### Test 5: Error con Herramienta Inexistente ✅
**Objetivo**: Validar manejo de errores al llamar herramienta que no existe  
**Valida**: Código de error -32602, mensaje descriptivo

### Test 6: Error con Método Desconocido ✅
**Objetivo**: Verificar respuesta a métodos no soportados  
**Valida**: Código de error -32601, mensaje "Method not found"

### Test 7: Formato JSON-RPC 2.0 ✅
**Objetivo**: Asegurar que todas las respuestas cumplen el estándar  
**Valida**: Campo `jsonrpc: "2.0"`, campo `id`, estructura correcta

### Test 8: Contexto de Usuario ✅
**Objetivo**: Verificar que el contexto se pasa correctamente a las herramientas  
**Valida**: userArn, userId, requestId llegan a la herramienta

### Test 9: Validación de Parámetros ✅
**Objetivo**: Probar manejo de parámetros faltantes  
**Valida**: Error cuando falta el nombre de la herramienta

### Test 10: Formato SSE ✅
**Objetivo**: Validar formato Server-Sent Events para streaming  
**Valida**: Prefijo `data:`, formato JSON, terminación `\n\n`

## 🚀 Ejecutar las Pruebas

### Paso 1: Instalar Dependencias

```bash
cd mcp-incidents-lambda
npm install
npm install --save-dev jest @types/jest ts-jest
```

### Paso 2: Compilar TypeScript

```bash
npm run build
```

### Paso 3: Ejecutar Tests

```bash
# Ejecutar todos los tests
npm test

# Ejecutar con output detallado
npm test -- --verbose

# Ejecutar con coverage
npm test -- --coverage

# Ejecutar en modo watch (desarrollo)
npm test -- --watch
```

## 📊 Resultado Esperado

```
PASS  src/__tests__/mcp-server.test.ts
  MCP Server - Plan de Pruebas Unitarias (10 tests)
    ✓ 1. Debe inicializar el servidor correctamente (3 ms)
    ✓ 2. Debe responder a solicitud de initialize con información del servidor (5 ms)
    ✓ 3. Debe listar todas las herramientas disponibles (4 ms)
    ✓ 4. Debe ejecutar herramienta con parámetros válidos (6 ms)
    ✓ 5. Debe retornar error al llamar herramienta inexistente (4 ms)
    ✓ 6. Debe retornar error con método desconocido (3 ms)
    ✓ 7. Debe mantener formato JSON-RPC 2.0 en todas las respuestas (4 ms)
    ✓ 8. Debe pasar contexto de usuario a la herramienta (5 ms)
    ✓ 9. Debe manejar llamada a herramienta sin nombre (3 ms)
    ✓ 10. Debe formatear respuestas para SSE correctamente (2 ms)

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
Snapshots:   0 total
Time:        2.456 s
```

## ✅ Criterios de Éxito

Para considerar las pruebas exitosas:

- [ ] **Todos los 10 tests pasan** (10/10)
- [ ] **Tiempo de ejecución < 5 segundos**
- [ ] **Sin errores de TypeScript**
- [ ] **Coverage > 80%** (opcional pero recomendado)

## 🔍 Troubleshooting

### Error: "Cannot find module"

```bash
# Solución: Instalar dependencias
npm install
npm install --save-dev jest @types/jest ts-jest
```

### Error: "Cannot find name 'describe'"

```bash
# Solución: Verificar que @types/jest está instalado
npm list @types/jest

# Si no está, instalar
npm install --save-dev @types/jest
```

### Error: "SyntaxError: Cannot use import statement"

```bash
# Solución: Verificar jest.config.js
cat jest.config.js

# Debe tener preset: 'ts-jest'
```

### Tests fallan por timeout

```bash
# Solución: Aumentar timeout en jest.config.js
# Añadir: testTimeout: 10000
```

## 📈 Próximos Pasos

Una vez que los 10 tests pasen:

1. ✅ **Tests unitarios completos** ← Estás aquí
2. ⏭️ **Tests con SAM Local** (sin AWS)
3. ⏭️ **Tests de integración** (con Bedrock)
4. ⏭️ **Despliegue a AWS**
5. ⏭️ **Tests E2E en AWS**

## 💡 Comandos Útiles

```bash
# Ver coverage detallado
npm test -- --coverage --coverageReporters=text-lcov

# Ejecutar solo un test
npm test -- -t "inicializar el servidor"

# Modo watch para desarrollo
npm test -- --watch

# Generar reporte HTML de coverage
npm test -- --coverage --coverageReporters=html
open coverage/index.html
```

## 📝 Notas Importantes

1. **Sin AWS**: Estos tests NO requieren credenciales AWS
2. **Rápidos**: Deben ejecutarse en < 5 segundos
3. **Aislados**: Cada test es independiente
4. **Mock Tool**: Usa una herramienta simulada, no la real
5. **Sin Bedrock**: No se conecta a servicios externos

## 🎓 Interpretación de Resultados

### ✅ Si todos pasan:
- El servidor MCP funciona correctamente
- La lógica de routing está bien
- El manejo de errores es correcto
- Puedes proceder a tests con SAM Local

### ❌ Si alguno falla:
1. Lee el mensaje de error
2. Revisa el código del test
3. Verifica la implementación en `src/mcp-server.ts`
4. Ejecuta solo ese test: `npm test -- -t "nombre del test"`
5. Usa `console.log()` para debugging

## 🔗 Referencias

- Archivo de tests: `src/__tests__/mcp-server.test.ts`
- Configuración Jest: `jest.config.js`
- Código a probar: `src/mcp-server.ts`
- Guía completa: `GUIA_TESTING.md`
