import { atom } from 'jotai';

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