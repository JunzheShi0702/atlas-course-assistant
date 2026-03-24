import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from './db';

describe.skipIf(!process.env.DATABASE_URL)('Database Integration Tests', () => {
  let testClient: any;

  beforeAll(async () => {
    testClient = await pool.connect();
  });

  afterAll(async () => {
    if (testClient) {
      testClient.release();
    }
  });

  describe('Connection', () => {
    it('should connect to database successfully', async () => {
      const result = await testClient.query('SELECT version();');
      expect(result.rows).toBeDefined();
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].version).toContain('PostgreSQL');
    });

    it('should have required extensions installed', async () => {
      const extensionsResult = await testClient.query(`
        SELECT extname 
        FROM pg_extension 
        WHERE extname IN ('vector', 'pgcrypto');
      `);
      
      const extensions = extensionsResult.rows.map((row: { extname: any; }) => row.extname);
      expect(extensions).toContain('vector');
      expect(extensions).toContain('pgcrypto');
    });
  });

  describe('Schema Validation', () => {
    it('should have all required tables', async () => {
      const tablesResult = await testClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
      `);
      
      const tableNames = tablesResult.rows.map((row: { table_name: any; }) => row.table_name);
      
      // Core existing tables
      expect(tableNames).toContain('course_embeddings');
      expect(tableNames).toContain('course_evaluations');
      
      // Issue #115 schedule tables  
      expect(tableNames).toContain('schedules');
      expect(tableNames).toContain('schedule_courses');
      expect(tableNames).toContain('schedule_audits');
    });

    it('should have correct schedule table schema', async () => {
      const scheduleSchema = await testClient.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'schedules' AND table_schema = 'public'
        ORDER BY ordinal_position;
      `);
      
      const columns = scheduleSchema.rows.map((col: { column_name: any; data_type: any; is_nullable: string; }) => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES'
      }));
      
      expect(columns).toContainEqual({ name: 'id', type: 'uuid', nullable: false });
      expect(columns).toContainEqual({ name: 'user_id', type: 'text', nullable: false });
      expect(columns).toContainEqual({ name: 'name', type: 'text', nullable: false });
      expect(columns).toContainEqual({ name: 'term', type: 'text', nullable: false });
      expect(columns).toContainEqual({ name: 'created_at', type: 'timestamp with time zone', nullable: false });
      expect(columns).toContainEqual({ name: 'updated_at', type: 'timestamp with time zone', nullable: false });
    });

    it('should have correct schedule_courses table schema', async () => {
      const schema = await testClient.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'schedule_courses' AND table_schema = 'public'
        ORDER BY ordinal_position;
      `);
      
      const columns = schema.rows.map((col: { column_name: any; data_type: any; is_nullable: string; }) => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES'
      }));
      
      expect(columns).toContainEqual({ name: 'schedule_id', type: 'uuid', nullable: false });
      expect(columns).toContainEqual({ name: 'course_code', type: 'text', nullable: false });
      expect(columns).toContainEqual({ name: 'sis_offering_name', type: 'text', nullable: false });
      expect(columns).toContainEqual({ name: 'term', type: 'text', nullable: false });
    });

    it('should have correct schedule_audits table schema', async () => {
      const schema = await testClient.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'schedule_audits' AND table_schema = 'public'
        ORDER BY ordinal_position;
      `);
      
      const columns = schema.rows.map((col: { column_name: any; data_type: any; is_nullable: string; }) => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES'
      }));
      
      expect(columns).toContainEqual({ name: 'id', type: 'uuid', nullable: false });
      expect(columns).toContainEqual({ name: 'schedule_id', type: 'uuid', nullable: false });
      expect(columns).toContainEqual({ name: 'result', type: 'jsonb', nullable: false });
      expect(columns).toContainEqual({ name: 'model_version', type: 'text', nullable: true });
    });
  });

  describe('Data Integrity', () => {
    it('should be able to query existing course data', async () => {
      const courseCount = await testClient.query('SELECT COUNT(*) as count FROM course_embeddings');
      expect(Number(courseCount.rows[0].count)).toBeGreaterThanOrEqual(0);
      
      const evalCount = await testClient.query('SELECT COUNT(*) as count FROM course_evaluations');
      expect(Number(evalCount.rows[0].count)).toBeGreaterThanOrEqual(0);
    });

    it('should be able to query schedule data', async () => {
      // These should pass even if no schedule data exists yet
      const scheduleCount = await testClient.query('SELECT COUNT(*) as count FROM schedules');
      expect(Number(scheduleCount.rows[0].count)).toBeGreaterThanOrEqual(0);
      
      const scheduleCoursesCount = await testClient.query('SELECT COUNT(*) as count FROM schedule_courses');
      expect(Number(scheduleCoursesCount.rows[0].count)).toBeGreaterThanOrEqual(0);
      
      const scheduleAuditsCount = await testClient.query('SELECT COUNT(*) as count FROM schedule_audits');
      expect(Number(scheduleAuditsCount.rows[0].count)).toBeGreaterThanOrEqual(0);
    });
  });
});