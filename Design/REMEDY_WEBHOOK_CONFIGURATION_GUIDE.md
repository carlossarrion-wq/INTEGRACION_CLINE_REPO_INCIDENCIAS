# Guía de Configuración de Webhook en BMC Remedy

## Resumen

Esta guía proporciona instrucciones paso a paso para configurar webhooks en BMC Remedy que envíen incidencias a AWS. Incluye permisos necesarios, configuración detallada y troubleshooting.

## Permisos Necesarios

### Permisos Mínimos Requeridos

Para configurar webhooks en Remedy, necesitas los siguientes permisos:

#### 1. Permisos de Administrador (Recomendado)

**Roles necesarios**:
- ✅ **Administrator** o **Remedy Administrator**: Acceso completo
- ✅ **Workflow Administrator**: Para crear/modificar Filters y Active Links

**Permisos específicos**:
- Create/Modify Filters
- Create/Modify Active Links
- Access to Developer Studio
- Access to Workflow Objects

#### 2. Permisos Alternativos (Mínimos)

Si no tienes permisos de administrador completo, necesitas al menos:

```
Permission Group: Workflow Objects
- Create Filter: Yes
- Modify Filter: Yes
- Delete Filter: Yes
- Create Active Link: Yes
- Modify Active Link: Yes
- Delete Active Link: Yes

Permission Group: Forms
- HPD:Help Desk: Read, Write

Permission Group: Developer Tools
- Access to Developer Studio: Yes
```

### Verificar Permisos Actuales

1. Login a Remedy
2. Ir a **User Tool** → **Preferences** → **Permissions**
3. Verificar que tienes acceso a:
   - Workflow Objects
   - Developer Studio
   - HPD:Help Desk form

## Métodos de Configuración

### Método 1: Usando BMC Remedy Developer Studio (Recomendado)

Este es el método más moderno y visual.

#### Paso 1: Abrir Developer Studio

1. Abrir **BMC Remedy Developer Studio**
2. Conectar al servidor Remedy
3. Seleccionar el servidor y autenticarse

#### Paso 2: Crear el Filter

1. En Developer Studio, ir a **File** → **New** → **Filter**
2. Configurar propiedades básicas:

```
Name: AWS_Incident_Sync_Filter
Form: HPD:Help Desk
Order: 500 (ajustar según necesidad)
Execute On: 
  ☑ Submit
  ☑ Modify
Enabled: Yes
```

3. Definir **Run If** qualification:

```
('Assigned Group' = "Your Target Group Name") AND 
('Status' != "Cancelled") AND
('Status' != "Rejected")
```

**Nota**: Reemplazar "Your Target Group Name" con el nombre real del grupo.

4. En la sección **If Actions**, añadir:
   - Action: **Run Process**
   - Type: **Active Link**
   - Name: `AWS_Sync_Active_Link` (lo crearemos después)

5. Guardar el Filter

#### Paso 3: Crear el Active Link

1. En Developer Studio, ir a **File** → **New** → **Active Link**
2. Configurar propiedades básicas:

```
Name: AWS_Sync_Active_Link
Form: HPD:Help Desk
Execute On: Display
Order: 500
Enabled: Yes
```

3. **Run If**: Dejar en blanco (se ejecutará siempre que sea llamado)

4. Añadir **Actions** (en orden):

##### Action 1: Set Fields (Preparar URL)

```
Action: Set Fields
Fields to Set:
  - Field: z1D_WorkInfo (o un campo temporal)
    Value: https://your-api-gateway-url.execute-api.eu-west-1.amazonaws.com/prod/incidents
```

##### Action 2: Set Fields (Preparar API Key)

```
Action: Set Fields
Fields to Set:
  - Field: z1D_WorkInfo2 (o un campo temporal)
    Value: your-api-key-here
```

**IMPORTANTE**: Por seguridad, considera usar un campo encriptado o Remedy's Credential Store.

##### Action 3: Set Fields (Preparar JSON Payload)

```
Action: Set Fields
Fields to Set:
  - Field: z1D_WorkInfo3 (campo temporal para JSON)
    Value: (usar Process Builder para construir JSON)
```

**JSON Template**:
```json
{
  "incident_id": "$Incident Number$",
  "title": "$Description$",
  "status": "$Status$",
  "priority": "$Priority$",
  "assigned_to": "$Assignee$",
  "assigned_group": "$Assigned Group$",
  "category": "$Categorization Tier 1$",
  "description": "$Detailed Description$",
  "created_date": "$Submit Date$",
  "modified_date": "$Modified Date$"
}
```

##### Action 4: Call REST API

```
Action: Service
Service Type: Web Service
Operation: HTTP POST

Configuration:
  URL: $z1D_WorkInfo$ (campo con URL)
  Method: POST
  
  Headers:
    - Name: x-api-key
      Value: $z1D_WorkInfo2$ (campo con API key)
    - Name: Content-Type
      Value: application/json
  
  Body: $z1D_WorkInfo3$ (campo con JSON)
  
  Response:
    - Store in: z1D_WorkInfo4 (campo temporal)
```

##### Action 5: Log Success/Error (Opcional)

```
Action: Set Fields
Run If: $z1D_WorkInfo4$ LIKE "%success%"
Fields to Set:
  - Field: Status History
    Value: "Synced to AWS at " + $TIMESTAMP$
```

6. Guardar el Active Link

### Método 2: Usando BMC Remedy Mid-Tier (Web Interface)

Si no tienes acceso a Developer Studio:

#### Paso 1: Acceder a Workflow Objects

1. Login a Remedy Mid-Tier
2. Ir a **Application Administration Console**
3. Navegar a **Custom Configuration** → **Workflow Objects**

#### Paso 2: Crear Filter

1. Click en **Filters** → **New**
2. Completar formulario:

```
Filter Name: AWS_Incident_Sync_Filter
Form Name: HPD:Help Desk
Order: 500
Execute On: Submit, Modify
Enabled: Yes

Run If:
  ('Assigned Group' = "Your Target Group") AND 
  ('Status' != "Cancelled")

Actions:
  - Run Process: AWS_Sync_Active_Link
```

3. Click **Save**

#### Paso 3: Crear Active Link

1. En Workflow Objects, click **Active Links** → **New**
2. Completar formulario similar al método anterior
3. Añadir acciones usando el formulario web

### Método 3: Usando Remedy API (Programático)

Para automatizar la configuración:

```python
# Python script usando pyars (Remedy Python API)
import pyars

# Conectar a Remedy
ar = pyars.ARServer('remedy-server', 'username', 'password')

# Crear Filter
filter_def = {
    'name': 'AWS_Incident_Sync_Filter',
    'form': 'HPD:Help Desk',
    'order': 500,
    'execute_on': ['Submit', 'Modify'],
    'enabled': True,
    'run_if': "('Assigned Group' = \"Your Target Group\")",
    'actions': [
        {
            'type': 'run_process',
            'process_name': 'AWS_Sync_Active_Link'
        }
    ]
}

ar.create_filter(filter_def)

# Crear Active Link
active_link_def = {
    'name': 'AWS_Sync_Active_Link',
    'form': 'HPD:Help Desk',
    'order': 500,
    'execute_on': 'Display',
    'enabled': True,
    'actions': [
        # Acciones definidas anteriormente
    ]
}

ar.create_active_link(active_link_def)
```

## Configuración Detallada del REST API Call

### Opción A: Usando Web Service (Remedy 9.x+)

```
Service Configuration:
  Service Name: AWS_Incident_Webhook
  Service Type: Web Service
  Endpoint: https://your-api-gateway.execute-api.eu-west-1.amazonaws.com/prod/incidents
  
  Authentication:
    Type: Custom Header
    Header Name: x-api-key
    Header Value: <your-api-key>
  
  Request:
    Method: POST
    Content-Type: application/json
    Body Template: (JSON template)
  
  Response Mapping:
    Success Code: 200
    Error Codes: 400, 401, 500
```

### Opción B: Usando Filter API (Remedy 8.x)

Si tu versión de Remedy no soporta Web Services directamente:

```
Action: Run Process
Process: External Script

Script:
  #!/bin/bash
  curl -X POST \
    -H "x-api-key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD" \
    "$API_ENDPOINT"
```

## Gestión de Credenciales

### Opción 1: Remedy Credential Store (Recomendado)

```
1. Ir a Application Administration Console
2. Navegar a Security → Credential Store
3. Crear nueva credencial:
   - Name: AWS_API_Key
   - Type: API Key
   - Value: <your-api-key>
   - Encryption: Yes

4. En Active Link, referenciar:
   - Value: $CREDENTIAL:AWS_API_Key$
```

### Opción 2: Encrypted Field

```
1. Crear campo custom en HPD:Help Desk
   - Field Name: AWS_API_Key
   - Type: Character
   - Encryption: Yes
   - Display: Hidden

2. Poblar valor una vez
3. Referenciar en Active Link: $AWS_API_Key$
```

### Opción 3: External Configuration (Menos Seguro)

```
1. Crear archivo de configuración en servidor Remedy
   - Path: /opt/remedy/config/aws_config.properties
   - Content: api_key=your-key-here
   - Permissions: 600 (solo lectura por Remedy)

2. Leer desde script externo
```

## Testing y Validación

### Paso 1: Test con Incident de Prueba

1. Crear incidencia de prueba en Remedy
2. Asignar al grupo configurado
3. Verificar en logs de Remedy:

```
Location: AR System Server → Logs → Filter.log
Look for: AWS_Incident_Sync_Filter executed
```

### Paso 2: Verificar Llamada API

1. En AWS CloudWatch, revisar logs:

```bash
aws logs tail /aws/lambda/remedy-sync-handler --follow
```

2. Buscar entrada correspondiente a la incidencia

### Paso 3: Verificar en DynamoDB

```bash
aws dynamodb scan \
  --table-name incidents \
  --filter-expression "source_system = :remedy" \
  --expression-attribute-values '{":remedy":{"S":"REMEDY"}}'
```

## Troubleshooting

### Problema 1: Filter no se ejecuta

**Síntomas**: No hay logs en Filter.log

**Soluciones**:
1. Verificar que el Filter está **Enabled**
2. Verificar **Run If** qualification:
   ```
   # Test qualification en Remedy
   Advanced Search → Test Qualification
   ```
3. Verificar **Order**: Debe ser único y no conflictuar con otros filters
4. Revisar permisos del usuario que modifica la incidencia

### Problema 2: Active Link falla

**Síntomas**: Filter se ejecuta pero no hay llamada API

**Soluciones**:
1. Verificar logs de Active Link:
   ```
   Location: AR System Server → Logs → ActiveLink.log
   ```
2. Verificar que el Active Link está **Enabled**
3. Verificar sintaxis del JSON payload
4. Test manual del endpoint:
   ```bash
   curl -X POST \
     -H "x-api-key: your-key" \
     -H "Content-Type: application/json" \
     -d '{"test": "data"}' \
     https://your-api-endpoint/prod/incidents
   ```

### Problema 3: API retorna error

**Síntomas**: Active Link se ejecuta pero API retorna 4xx/5xx

**Soluciones**:
1. Verificar API Key es correcta
2. Verificar formato JSON es válido
3. Verificar campos requeridos están presentes
4. Revisar CloudWatch Logs en AWS:
   ```bash
   aws logs tail /aws/apigateway/remedy-sync --follow
   ```

### Problema 4: Timeout

**Síntomas**: Active Link tarda mucho o timeout

**Soluciones**:
1. Aumentar timeout en Active Link configuration
2. Verificar conectividad de red Remedy → AWS
3. Verificar DNS resolution
4. Considerar hacer llamada asíncrona

## Mejores Prácticas

### 1. Error Handling

```
Action: Set Fields
Run If: $API_Response$ LIKE "%error%"
Fields to Set:
  - Field: Status History
    Value: "AWS Sync Failed: " + $API_Response$
  - Field: z1D_Action (Work Log)
    Value: "Failed to sync to AWS. Manual intervention required."
```

### 2. Retry Logic

```
Filter: AWS_Incident_Sync_Retry
Execute On: Modify
Run If: 
  ('Status History' LIKE "%AWS Sync Failed%") AND
  ('z1D_Retry_Count' < 3)

Actions:
  - Increment z1D_Retry_Count
  - Wait 60 seconds
  - Run Process: AWS_Sync_Active_Link
```

### 3. Logging

```
Action: Set Fields
Fields to Set:
  - Field: z1D_Action (Work Log)
    Value: "Synced to AWS. Response: " + $API_Response$
  - Field: Status History
    Value: "AWS Sync: " + $TIMESTAMP$
```

### 4. Monitoring

Crear dashboard en Remedy para monitorear:
- Incidencias sincronizadas exitosamente
- Incidencias con errores de sincronización
- Tiempo promedio de sincronización

## Checklist de Implementación

- [ ] Verificar permisos de administrador o workflow
- [ ] Desplegar infraestructura AWS (API Gateway + Lambda)
- [ ] Obtener API Key de AWS
- [ ] Crear Filter en Remedy
- [ ] Crear Active Link en Remedy
- [ ] Configurar credenciales de forma segura
- [ ] Probar con incidencia de prueba
- [ ] Verificar logs en Remedy
- [ ] Verificar logs en AWS CloudWatch
- [ ] Verificar datos en DynamoDB
- [ ] Configurar error handling
- [ ] Configurar retry logic
- [ ] Documentar configuración
- [ ] Entrenar al equipo de soporte

## Contactos y Soporte

### Remedy Administration
- Contactar al equipo de Remedy Admin para permisos
- Solicitar acceso a Developer Studio si es necesario
- Coordinar ventana de mantenimiento para testing

### AWS Administration
- Verificar API Gateway está desplegado
- Obtener API Key
- Configurar monitoreo en CloudWatch

## Referencias

- [BMC Remedy Developer Studio Guide](https://docs.bmc.com/docs/ars2002/developer-studio-overview-969834817.html)
- [BMC Remedy Workflow Objects](https://docs.bmc.com/docs/ars2002/workflow-objects-969834818.html)
- [BMC Remedy REST API](https://docs.bmc.com/docs/ars2002/rest-api-overview-969834815.html)
- [AWS API Gateway Documentation](https://docs.aws.amazon.com/apigateway/)

## Apéndice: Plantillas de Configuración

### Template: Filter Definition

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Filter>
  <Name>AWS_Incident_Sync_Filter</Name>
  <Form>HPD:Help Desk</Form>
  <Order>500</Order>
  <ExecuteOn>
    <Submit>true</Submit>
    <Modify>true</Modify>
  </ExecuteOn>
  <Enabled>true</Enabled>
  <RunIf>
    <Qualification>
      ('Assigned Group' = "Your Target Group") AND 
      ('Status' != "Cancelled")
    </Qualification>
  </RunIf>
  <Actions>
    <Action>
      <Type>RunProcess</Type>
      <ProcessName>AWS_Sync_Active_Link</ProcessName>
    </Action>
  </Actions>
</Filter>
```

### Template: Active Link Definition

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ActiveLink>
  <Name>AWS_Sync_Active_Link</Name>
  <Form>HPD:Help Desk</Form>
  <Order>500</Order>
  <ExecuteOn>Display</ExecuteOn>
  <Enabled>true</Enabled>
  <Actions>
    <!-- Actions defined in main document -->
  </Actions>
</ActiveLink>
```

## Conclusión

La configuración de webhooks en Remedy requiere permisos de administrador o workflow administrator. El proceso es relativamente sencillo usando Developer Studio, pero requiere atención al detalle en la configuración de credenciales y manejo de errores. Siguiendo esta guía paso a paso, podrás configurar una integración robusta y segura entre Remedy y AWS.
