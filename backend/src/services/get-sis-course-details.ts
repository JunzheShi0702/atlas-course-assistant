import type { SisCourse } from "../tools/search-courses-by-sis-constraints";
import { mapRawToSisCourse } from "../tools/search-courses-by-sis-constraints";
import { fetchSisCourseDetails, parseCourseId } from "./sis-client";

export interface GetSisCourseDetailsResult {
  courseId: string;
  course: SisCourse | null;
  message?: string;
}

const INVALID_COURSE_ID_MESSAGE =
  "Invalid courseId format. Expected values like en-553-171-spring-2026 or en-553-171-01-spring-2026.";

export async function getSisCourseDetails(
  courseId: string,
): Promise<GetSisCourseDetailsResult> {
  try {
    parseCourseId(courseId);
  } catch {
    return {
      courseId,
      course: null,
      message: INVALID_COURSE_ID_MESSAGE,
    };
  }

  const rawCourse = await fetchSisCourseDetails(courseId);

  if (!rawCourse) {
    return {
      courseId,
      course: null,
      message: "Course not found",
    };
  }

  return {
    courseId,
    course: mapRawToSisCourse(rawCourse),
  };
}
