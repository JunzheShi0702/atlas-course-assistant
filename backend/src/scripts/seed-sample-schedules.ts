/**
 * Seed sample schedule data for development/testing
 * 
 * This script creates realistic schedule data including:
 * - Sample schedules for a test user
 * - Course assignments with JHU course codes  
 * - AI-generated schedule audits with workload estimates
 * 
 * Run: npm run ts-node src/scripts/seed-sample-schedules.ts
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import type { ScheduleAuditResult } from '../types/database';

dotenv.config();

interface SampleCourse {
  code: string;
  name: string;
  term: string;
}

async function seedSampleData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('supabase.com') 
      ? { rejectUnauthorized: false } 
      : false,
  });

  try {
    console.log('🌱 Seeding sample schedule data to Atlas...');
    
    const client = await pool.connect();

    // Sample user ID (would come from OAuth in real app)
    const testUserId = 'test-user-12345';
    
    // 1. Create sample schedules
    console.log('📋 Creating sample schedules...');
    
    const schedule1 = await client.query(`
      INSERT INTO schedules (user_id, name, term) 
      VALUES ($1, $2, $3) 
      ON CONFLICT DO NOTHING 
      RETURNING *
    `, [testUserId, 'Spring 2026 - Computer Science Focus', 'Spring 2026']);
    
    const schedule2 = await client.query(`
      INSERT INTO schedules (user_id, name, term) 
      VALUES ($1, $2, $3) 
      ON CONFLICT DO NOTHING 
      RETURNING *
    `, [testUserId, 'Spring 2026 - Light Load', 'Spring 2026']);
    
    const scheduleId1 = schedule1.rows[0]?.id || 
      (await client.query('SELECT id FROM schedules WHERE name = $1', ['Spring 2026 - Computer Science Focus'])).rows[0].id;
    const scheduleId2 = schedule2.rows[0]?.id || 
      (await client.query('SELECT id FROM schedules WHERE name = $1', ['Spring 2026 - Light Load'])).rows[0].id;
    
    console.log('✅ Created schedules:', { scheduleId1, scheduleId2 });

    // 2. Add sample courses to schedules
    console.log('📚 Adding courses to schedules...');
    
    // Schedule 1: CS Focus (heavy load)
    const schedule1Courses: SampleCourse[] = [
      { code: 'EN.601.226', name: 'Data Structures', term: 'Spring 2026' },
      { code: 'EN.601.315', name: 'Databases', term: 'Spring 2026' },
      { code: 'EN.553.171', name: 'Discrete Mathematics', term: 'Spring 2026' },
      { code: 'EN.601.280', name: 'Full-Stack JavaScript', term: 'Spring 2026' },
      { code: 'AS.110.202', name: 'Calculus III', term: 'Spring 2026' }
    ];

    for (const course of schedule1Courses) {
      await client.query(`
        INSERT INTO schedule_courses (schedule_id, course_code, sis_offering_name, term) 
        VALUES ($1, $2, $3, $4) 
        ON CONFLICT DO NOTHING
      `, [scheduleId1, course.code, course.name, course.term]);
    }

    // Schedule 2: Light Load  
    const schedule2Courses: SampleCourse[] = [
      { code: 'EN.601.120', name: 'Intermediate Programming', term: 'Spring 2026' },
      { code: 'AS.100.102', name: 'Introduction to Fiction', term: 'Spring 2026' },
      { code: 'AS.150.118', name: 'Introduction to Microeconomics', term: 'Spring 2026' }
    ];

    for (const course of schedule2Courses) {
      await client.query(`
        INSERT INTO schedule_courses (schedule_id, course_code, sis_offering_name, term) 
        VALUES ($1, $2, $3, $4) 
        ON CONFLICT DO NOTHING
      `, [scheduleId2, course.code, course.name, course.term]);
    }

    console.log('✅ Added courses to both schedules');

    // 3. Create sample schedule audits (AI feedback)
    console.log('🤖 Creating sample schedule audits...');
    
    const audit1Result: ScheduleAuditResult = {
      workloadRange: { min: 15, max: 18 },
      difficulty: 4,
      feasibilityLabel: 'heavy',
      narrativeSummary: 'This is a rigorous computer science-focused schedule with 17 credits. The combination of Data Structures, Databases, and Full-Stack JavaScript creates a programming-heavy semester. Discrete Math adds theoretical depth. Expect 20+ hours of coding per week.',
      goalAlignment: 'Excellent preparation for software engineering internships and advanced CS coursework.',
      recommendations: [
        'Consider dropping one technical course if you have no prior database experience',
        'Form study groups for Data Structures - notoriously challenging at JHU',
        'Start final projects early, especially for Full-Stack JavaScript'
      ]
    };

    await client.query(`
      INSERT INTO schedule_audits (schedule_id, result, model_version) 
      VALUES ($1, $2, $3) 
      ON CONFLICT DO NOTHING
    `, [scheduleId1, JSON.stringify(audit1Result), 'gpt-4o-mini-2024-07-18']);

    const audit2Result: ScheduleAuditResult = {
      workloadRange: { min: 9, max: 12 },
      difficulty: 2,
      feasibilityLabel: 'light',
      narrativeSummary: 'A manageable 12-credit schedule mixing computer science with humanities and social sciences. Intermediate Programming provides good technical foundation without overwhelming workload. Fiction and Economics offer valuable breadth.',
      goalAlignment: 'Good for students exploring different fields or managing other commitments.',
      recommendations: [
        'Consider adding a fourth course if you want full-time status',
        'This schedule leaves time for extracurriculars or part-time work',
        'Strong foundation for deciding on a major'
      ]
    };

    await client.query(`
      INSERT INTO schedule_audits (schedule_id, result, model_version) 
      VALUES ($1, $2, $3) 
      ON CONFLICT DO NOTHING  
    `, [scheduleId2, JSON.stringify(audit2Result), 'gpt-4o-mini-2024-07-18']);

    console.log('✅ Created AI-generated schedule audits');

    // 4. Verify the data was inserted
    console.log('📊 Verifying inserted data...');
    
    const scheduleCount = await client.query('SELECT COUNT(*) FROM schedules WHERE user_id = $1', [testUserId]);
    const courseCount = await client.query(`
      SELECT COUNT(*) FROM schedule_courses sc 
      JOIN schedules s ON sc.schedule_id = s.id 
      WHERE s.user_id = $1
    `, [testUserId]);
    const auditCount = await client.query(`
      SELECT COUNT(*) FROM schedule_audits sa 
      JOIN schedules s ON sa.schedule_id = s.id 
      WHERE s.user_id = $1
    `, [testUserId]);

    console.log('📈 Sample data summary:');
    console.log(`   📋 Schedules created: ${scheduleCount.rows[0].count}`);
    console.log(`   📚 Courses added: ${courseCount.rows[0].count}`);
    console.log(`   🤖 Audits generated: ${auditCount.rows[0].count}`);

    // 5. Show what was created
    const schedulesWithCourses = await client.query(`
      SELECT 
        s.id,
        s.name as schedule_name,
        s.term,
        s.created_at,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'course_code', sc.course_code,
              'course_name', sc.sis_offering_name
            )
          ) FILTER (WHERE sc.course_code IS NOT NULL),
          '[]'
        ) as courses
      FROM schedules s
      LEFT JOIN schedule_courses sc ON s.id = sc.schedule_id
      WHERE s.user_id = $1
      GROUP BY s.id, s.name, s.term, s.created_at
      ORDER BY s.created_at DESC
    `, [testUserId]);

    console.log('🎯 Created schedules with courses:');
    schedulesWithCourses.rows.forEach((row: any) => {
      console.log(`\\n📋 ${row.schedule_name} (${row.term})`);
      console.log(`   📅 Created: ${row.created_at}`);
      console.log(`   📚 Courses (${row.courses.length}):`);
      row.courses.forEach((course: any) => {
        console.log(`     - ${course.course_code}: ${course.course_name}`);
      });
    });

    client.release();
    await pool.end();
    
    console.log('\\n🎉 Sample data seeding completed successfully!');
    console.log('\\n🔍 You can now verify this data exists in your Atlas Supabase dashboard');
    console.log('📊 Or create frontend components to display schedules for user:', testUserId);
    
  } catch (error) {
    console.error('❌ Error seeding sample data:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  seedSampleData();
}