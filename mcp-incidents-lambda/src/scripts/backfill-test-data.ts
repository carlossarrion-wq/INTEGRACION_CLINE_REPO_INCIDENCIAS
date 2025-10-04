/**
 * Script para poblar la tabla de incidencias con datos de prueba
 * Uso: ts-node src/scripts/backfill-test-data.ts
 */

import { IncidentService } from '../services/incident-service';
import { CreateIncidentInput } from '../types/incident';
import { logger } from '../utils/logger';

const testIncidents: CreateIncidentInput[] = [
  {
    external_id: 'JIRA-12345',
    source_system: 'JIRA',
    source_url: 'https://jira.company.com/browse/JIRA-12345',
    title: 'Database connection timeout in production',
    description: 'Users are experiencing intermittent timeouts when connecting to the database. The issue started around 10:00 AM and affects approximately 30% of requests.',
    category: 'Infrastructure',
    severity: 'HIGH',
    priority: 'P1',
    status: 'ASSIGNED',
    assigned_to: 'developer@company.com',
    team: 'Backend',
    due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    affected_systems: ['API Gateway', 'Database', 'User Service'],
    environment: 'PRODUCTION',
    error_message: 'Connection timeout after 30 seconds',
    tags: ['database', 'timeout', 'production', 'urgent'],
  },
  {
    external_id: 'JIRA-12346',
    source_system: 'JIRA',
    source_url: 'https://jira.company.com/browse/JIRA-12346',
    title: 'Memory leak in payment processing service',
    description: 'The payment processing service is showing increasing memory usage over time, eventually leading to OOM errors and service restarts.',
    category: 'Application',
    severity: 'CRITICAL',
    priority: 'P1',
    status: 'IN_PROGRESS',
    assigned_to: 'developer@company.com',
    team: 'Payments',
    due_date: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    affected_systems: ['Payment Service', 'Order Processing'],
    environment: 'PRODUCTION',
    error_message: 'java.lang.OutOfMemoryError: Java heap space',
    tags: ['memory-leak', 'payment', 'critical', 'production'],
  },
  {
    external_id: 'REMEDY-INC0012345',
    source_system: 'REMEDY',
    source_url: 'https://remedy.company.com/incident/INC0012345',
    title: 'SSL certificate expiring in 7 days',
    description: 'The SSL certificate for api.company.com is set to expire in 7 days. Need to renew and deploy the new certificate.',
    category: 'Security',
    severity: 'MEDIUM',
    priority: 'P2',
    status: 'NEW',
    assigned_to: 'devops@company.com',
    team: 'DevOps',
    due_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    affected_systems: ['API Gateway', 'Load Balancer'],
    environment: 'PRODUCTION',
    tags: ['ssl', 'certificate', 'security'],
  },
  {
    external_id: 'JIRA-12347',
    source_system: 'JIRA',
    source_url: 'https://jira.company.com/browse/JIRA-12347',
    title: 'Slow query performance on user dashboard',
    description: 'Users are reporting slow load times (>10 seconds) when accessing their dashboard. Database queries are taking longer than expected.',
    category: 'Performance',
    severity: 'MEDIUM',
    priority: 'P2',
    status: 'ASSIGNED',
    assigned_to: 'developer@company.com',
    team: 'Frontend',
    due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    affected_systems: ['User Dashboard', 'Database'],
    environment: 'PRODUCTION',
    error_message: 'Query execution time: 12.5 seconds',
    tags: ['performance', 'database', 'dashboard'],
  },
  {
    external_id: 'SERVICENOW-INC0067890',
    source_system: 'SERVICENOW',
    title: 'Failed backup job for customer database',
    description: 'The nightly backup job for the customer database failed with error code 500. Need to investigate and re-run the backup.',
    category: 'Infrastructure',
    severity: 'HIGH',
    priority: 'P1',
    status: 'NEW',
    assigned_to: 'dba@company.com',
    team: 'Database',
    due_date: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    affected_systems: ['Backup System', 'Customer Database'],
    environment: 'PRODUCTION',
    error_message: 'Backup failed with exit code 500',
    tags: ['backup', 'database', 'critical'],
  },
  {
    external_id: 'JIRA-12348',
    source_system: 'JIRA',
    source_url: 'https://jira.company.com/browse/JIRA-12348',
    title: 'API rate limiting not working correctly',
    description: 'The API rate limiting mechanism is not properly throttling requests, allowing some clients to exceed their quota.',
    category: 'Application',
    severity: 'MEDIUM',
    priority: 'P3',
    status: 'NEW',
    team: 'API',
    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    affected_systems: ['API Gateway', 'Rate Limiter'],
    environment: 'PRODUCTION',
    tags: ['api', 'rate-limiting', 'security'],
  },
  {
    external_id: 'JIRA-12349',
    source_system: 'JIRA',
    source_url: 'https://jira.company.com/browse/JIRA-12349',
    title: 'Email notifications not being sent',
    description: 'Users are not receiving email notifications for order confirmations. The email service appears to be down or misconfigured.',
    category: 'Application',
    severity: 'HIGH',
    priority: 'P2',
    status: 'ASSIGNED',
    assigned_to: 'developer@company.com',
    team: 'Notifications',
    due_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    affected_systems: ['Email Service', 'Notification Queue'],
    environment: 'PRODUCTION',
    error_message: 'SMTP connection refused',
    tags: ['email', 'notifications', 'smtp'],
  },
  {
    external_id: 'REMEDY-INC0012346',
    source_system: 'REMEDY',
    title: 'Disk space running low on application server',
    description: 'Application server app-prod-01 is at 85% disk capacity. Need to clean up old logs and temporary files.',
    category: 'Infrastructure',
    severity: 'MEDIUM',
    priority: 'P3',
    status: 'NEW',
    team: 'DevOps',
    due_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    affected_systems: ['Application Server'],
    environment: 'PRODUCTION',
    tags: ['disk-space', 'infrastructure', 'maintenance'],
  },
];

async function main() {
  logger.info('Starting backfill of test data');
  
  const service = new IncidentService();
  
  try {
    const result = await service.batchCreateIncidents(testIncidents);
    
    logger.info('Backfill completed', {
      created: result.created,
      failed: result.failed,
      total: testIncidents.length,
    });
    
    if (result.errors.length > 0) {
      logger.error('Errors during backfill', { errors: result.errors });
    }
    
    console.log('\n✅ Backfill completado exitosamente');
    console.log(`   Creadas: ${result.created}`);
    console.log(`   Fallidas: ${result.failed}`);
    console.log(`   Total: ${testIncidents.length}`);
    
    if (result.errors.length > 0) {
      console.log('\n⚠️  Errores:');
      result.errors.forEach((error) => console.log(`   - ${error}`));
    }
    
    // Verificar algunas incidencias
    console.log('\n📊 Verificando incidencias creadas...');
    
    const myIncidents = await service.searchMyIncidents('developer@company.com', {
      limit: 5,
    });
    
    console.log(`\n✅ Encontradas ${myIncidents.count} incidencias asignadas a developer@company.com:`);
    myIncidents.incidents.forEach((inc) => {
      console.log(`   - ${inc.incident_id}: ${inc.title} [${inc.status}]`);
    });
    
    const newIncidents = await service.searchByStatus('NEW', { limit: 5 });
    console.log(`\n✅ Encontradas ${newIncidents.count} incidencias en estado NEW:`);
    newIncidents.incidents.forEach((inc) => {
      console.log(`   - ${inc.incident_id}: ${inc.title} [${inc.priority}]`);
    });
    
  } catch (error) {
    logger.error('Backfill failed', { error });
    console.error('\n❌ Error durante el backfill:', error);
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✅ Script completado');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

export { testIncidents };
