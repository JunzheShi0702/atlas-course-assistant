import { atom } from 'jotai';
import { ensureCatalogCourseCode } from '@/lib/catalogCourseCode';

// Types for conversation history
export type MessageType = 'search' | 'conversation';

export interface CourseCard {
  id: string;
  courseCode: string;
  courseTitle: string;
  instructor: string;
  description: string;
  credits?: number;
  workload?: number;
  difficulty?: number;
  /** Recommendation reasoning for semantic matches (displayed above the card) */
  matchReasoning?: string;
  /** Deterministic preference compliance status from backend recommendation checks. */
  preferenceAlignment?: "aligned" | "mismatch";
  /** Specific mismatch reasons when preferenceAlignment is mismatch. */
  preferenceMismatchReasons?: Array<"days" | "time_window">;
  /** Additive ranking provenance from backend search normalization. */
  matchType?: "exact" | "constraint" | "semantic" | "hybrid";
  /** Additive explicit-constraint alignment status from backend. */
  constraintAlignment?: "aligned" | "mismatch" | "unknown";
  /** Specific mismatch reasons when constraintAlignment is mismatch. */
  constraintMismatchReasons?: Array<
    | "days"
    | "time_window"
    | "school"
    | "level"
    | "department"
    | "credits"
    | "writing_intensive"
    | "course_number"
    | "instructor"
  >;
  /** Full SIS course details (fetched on demand) */
  sisDetails?: SisCourseDetails;
  /** SIS offering name for schedule course API calls (e.g. "EN.601.482") */
  sisOfferingName?: string;
  /** Academic term for schedule course API calls (e.g. "Spring 2026") */
  term?: string;
}

export interface SisCourseDetails {
  offeringName: string;
  sectionName: string;
  title: string;
  description: string;
  schoolName: string;
  department: string;
  level: string;
  timeOfDay: string;
  daysOfWeek: string;
  location: string;
  instructors: string[];
  status: string;
  prerequisites?: string;
}

export interface HistoryMessage {
  id: string;
  type: MessageType;
  prompt: string; // e.g., "Results for 'Data Structures'"
  timestamp: Date;
  response: CourseCard[];
}

// Main history atom
export const historyAtom = atom<HistoryMessage[]>([]);

// Derived atom to get only search history
export const searchHistoryAtom = atom((get) => {
  const history = get(historyAtom);
  return history.filter((msg) => msg.type === 'search');
});

// Derived atom to get only conversation history
export const conversationHistoryAtom = atom((get) => {
  const history = get(historyAtom);
  return history.filter((msg) => msg.type === 'conversation');
});

// Atom for adding a new message
export const addMessageAtom = atom(
  null,
  (get, set, newMessage: Omit<HistoryMessage, 'id' | 'timestamp'>) => {
    const currentHistory = get(historyAtom);
    const message: HistoryMessage = {
      ...newMessage,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
    };
    set(historyAtom, [...currentHistory, message]);
  }
);

// Atom for clearing history
export const clearHistoryAtom = atom(null, (_get, set) => {
  set(historyAtom, []);
});

// Atom for removing a specific message
export const removeMessageAtom = atom(
  null,
  (get, set, messageId: string) => {
    const currentHistory = get(historyAtom);
    set(
      historyAtom,
      currentHistory.filter((msg) => msg.id !== messageId)
    );
  }
);

// Shortlist: courses added by user (course code + name only)
export interface ShortlistItem {
  id: string;
  courseCode: string;
  courseTitle: string;
  /** When present, used to normalize bare ###.### codes to AS./EN. catalog form */
  sisOfferingName?: string;
}

export const shortlistAtom = atom<ShortlistItem[]>([]);

export const addToShortlistAtom = atom(
  null,
  (get, set, item: ShortlistItem) => {
    const shortlist = get(shortlistAtom);
    if (shortlist.some((c) => c.id === item.id)) return;
    const normalized = ensureCatalogCourseCode(item.courseCode, item.sisOfferingName);
    const key = normalized.toLowerCase();
    if (shortlist.some((c) => ensureCatalogCourseCode(c.courseCode, c.sisOfferingName).toLowerCase() === key)) {
      return;
    }
    set(shortlistAtom, [...shortlist, { ...item, courseCode: normalized }]);
  }
);

export const removeFromShortlistAtom = atom(null, (get, set, id: string) => {
  const shortlist = get(shortlistAtom);
  set(shortlistAtom, shortlist.filter((c) => c.id !== id));
});

// Course to be quoted in next chat message
export const quotedCourseAtom = atom<CourseCard | null>(null);

// Authenticated user (null = not logged in / not yet checked)
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export const currentUserAtom = atom<CurrentUser | null>(null);
