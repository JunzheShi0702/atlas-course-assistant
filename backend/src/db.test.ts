import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  pool, 
  createSchedule, 
  getSchedulesByUserId,
  addCourseToSchedule, 
  getScheduleCourses,
  removeCourseFromSchedule,
  verifyScheduleOwnership,
  createScheduleAudit,
  getLatestScheduleAudit
} from './db';

describe('Database Schema Tests - Task #115', () => {
  let testUserId: string;
  let testScheduleId: string;

  beforeEach(async () => {
    // Use a mock user ID for testing (OAuth team will implement actual users)
    testUserId = 'test-user-123';
    
    // Create a test schedule
    const testSchedule = await createSchedule(testUserId, 'Test Schedule', 'Spring 2026');
    testScheduleId = testSchedule.id;
  });

  afterEach(async () => {
    // Clean up test data
    await pool.query('DELETE FROM schedule_audits WHERE schedule_id IN (SELECT id FROM schedules WHERE user_id = $1)', [testUserId]);
    await pool.query('DELETE FROM schedule_courses WHERE schedule_id IN (SELECT id FROM schedules WHERE user_id = $1)', [testUserId]);
    await pool.query('DELETE FROM schedules WHERE user_id = $1', [testUserId]);
  });

  describe('Schedule Functions', () => {
    it('should create and retrieve schedules', async () => {
      const schedules = await getSchedulesByUserId(testUserId);
      expect(schedules).toHaveLength(1);
      expect(schedules[0].name).toBe('Test Schedule');
      expect(schedules[0].term).toBe('Spring 2026');
      expect(schedules[0].user_id).toBe(testUserId);
    });

    it('should verify schedule ownership', async () => {
      const isOwner = await verifyScheduleOwnership(testScheduleId, testUserId);
      expect(isOwner).toBe(true);

      // Test with wrong user
      const wrongUserId = 'other-user-456';
      const isNotOwner = await verifyScheduleOwnership(testScheduleId, wrongUserId);
      expect(isNotOwner).toBe(false);
    });
  });

  describe('Schedule Course Functions', () => {
    it('should add and retrieve courses from schedule', async () => {
      await addCourseToSchedule(testScheduleId, 'EN.553.171', 'Data Structures', 'Spring 2026');
      
      const courses = await getScheduleCourses(testScheduleId);
      expect(courses).toHaveLength(1);
      expect(courses[0].course_code).toBe('EN.553.171');
      expect(courses[0].sis_offering_name).toBe('Data Structures');
    });

    it('should remove courses from schedule', async () => {
      // Add a course first
      await addCourseToSchedule(testScheduleId, 'EN.553.171', 'Data Structures', 'Spring 2026');
      
      // Verify it was added
      let courses = await getScheduleCourses(testScheduleId);
      expect(courses).toHaveLength(1);
      
      // Remove it
      const removed = await removeCourseFromSchedule(testScheduleId, 'EN.553.171', 'Data Structures', 'Spring 2026');
      expect(removed).toBe(true);
      
      // Verify it was removed
      courses = await getScheduleCourses(testScheduleId);
      expect(courses).toHaveLength(0);
    });

    it('should handle duplicate course additions gracefully', async () => {
      // Add the same course twice
      await addCourseToSchedule(testScheduleId, 'EN.553.171', 'Data Structures', 'Spring 2026');
      await addCourseToSchedule(testScheduleId, 'EN.553.171', 'Data Structures', 'Spring 2026');
      
      // Should only have one course
      const courses = await getScheduleCourses(testScheduleId);
      expect(courses).toHaveLength(1);
    });
  });

  describe('Schedule Audit Functions', () => {
    it('should create and retrieve schedule audits', async () => {
      const auditResult = {
        workloadRange: { min: 12, max: 18 },
        difficulty: 3.5,
        feasibilityLabel: 'moderate' as const,
        narrativeSummary: 'This is a test audit summary'
      };

      // Create audit
      const audit = await createScheduleAudit(testScheduleId, auditResult, 'gpt-4o-mini');
      expect(audit.schedule_id).toBe(testScheduleId);
      expect(audit.model_version).toBe('gpt-4o-mini');
      
      // Retrieve latest audit
      const latest = await getLatestScheduleAudit(testScheduleId);
      expect(latest).toBeTruthy();
      expect(latest?.result.narrativeSummary).toBe('This is a test audit summary');
      expect(latest?.result.feasibilityLabel).toBe('moderate');
    });
  });
});