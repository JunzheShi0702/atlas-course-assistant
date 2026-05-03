import { Buffer } from "node:buffer";

const RMP_GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql";
const RMP_AUTH = "Basic dGVzdDp0ZXN0";
const TIMEOUT_MS = 8_000;

const SEARCH_QUERY = `
  query NewSearchTeachersQuery($query: TeacherSearchQuery!) {
    newSearch {
      teachers(query: $query, first: 5) {
        edges {
          node {
            id
            firstName
            lastName
            department
            school { name }
            avgRating
            avgDifficulty
            wouldTakeAgainPercent
            numRatings
            teacherRatingTags {
              tagName
              tagCount
            }
            ratings(first: 3) {
              edges {
                node {
                  date
                  class
                  comment
                  helpfulRating
                }
              }
            }
          }
        }
      }
    }
  }
`;

export interface RmpTag {
  tag: string;
  count: number;
}

export interface RmpComment {
  date: string;
  year: number | null;
  class: string;
  comment: string;
  rating: number;
}

export interface RmpProfessorResult {
  found: true;
  name: string;
  department: string;
  profileUrl: string;
  overallRating: number;
  difficulty: number;
  wouldTakeAgainPercent: number | null;
  numRatings: number;
  topTags: RmpTag[];
  recentComments: RmpComment[];
}

export interface RmpNoResult {
  found: false;
  message: string;
}

export type RmpResult = RmpProfessorResult | RmpNoResult;

export interface RmpTeacherNode {
  id: string;
  firstName: string;
  lastName: string;
  department: string;
  school: { name: string };
  avgRating: number;
  avgDifficulty: number;
  wouldTakeAgainPercent: number;
  numRatings: number;
  teacherRatingTags: { tagName: string; tagCount: number }[];
  ratings: {
    edges: {
      node: { date: string; class: string; comment: string; helpfulRating: number };
    }[];
  };
}

export interface RmpEdge {
  node: RmpTeacherNode;
}

function extractCommentYear(date: string): number | null {
  const parsed = new Date(date);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getFullYear();
  }

  const match = date.match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

export function bestProfessorMatch(
  edges: RmpEdge[],
  lastName: string,
): RmpEdge | null {
  if (!edges.length) return null;
  const lower = lastName.toLowerCase();
  // Filter to JHU professors client-side (avoids relying on an opaque school ID)
  const jhuEdges = edges.filter((e) =>
    e.node.school.name.toLowerCase().includes("johns hopkins"),
  );
  const pool = jhuEdges.length ? jhuEdges : edges;
  const exact = pool.find((e) => e.node.lastName.toLowerCase() === lower);
  if (exact) return exact;
  const prefix = pool.find((e) =>
    e.node.lastName.toLowerCase().startsWith(lower),
  );
  return prefix ?? null;
}

export function mapRmpNodeToResult(node: RmpTeacherNode): RmpProfessorResult {
  const numericId = Buffer.from(node.id, "base64").toString("utf8").split("-")[1] ?? node.id;
  return {
    found: true,
    name: `${node.firstName} ${node.lastName}`,
    department: node.department,
    profileUrl: `https://www.ratemyprofessors.com/professor/${numericId}`,
    overallRating: node.avgRating,
    difficulty: node.avgDifficulty,
    wouldTakeAgainPercent:
      node.wouldTakeAgainPercent === -1 ? null : node.wouldTakeAgainPercent,
    numRatings: node.numRatings,
    topTags: node.teacherRatingTags
      .slice(0, 5)
      .map((t) => ({ tag: t.tagName, count: t.tagCount })),
    recentComments: [...node.ratings.edges]
      .sort((a, b) => b.node.date.localeCompare(a.node.date))
      .slice(0, 3)
      .map((e) => ({
        date: e.node.date,
        year: extractCommentYear(e.node.date),
        class: e.node.class,
        comment: e.node.comment,
        rating: e.node.helpfulRating,
      })),
  };
}

export async function searchRateMyProfessor(
  professorLastName: string,
): Promise<RmpResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(RMP_GRAPHQL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: RMP_AUTH,
        },
        body: JSON.stringify({
          query: SEARCH_QUERY,
          variables: {
            query: { text: professorLastName },
          },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return { found: false, message: "Rate My Professor lookup unavailable." };
    }

    const json = (await response.json()) as {
      data?: { newSearch?: { teachers?: { edges?: RmpEdge[] } } };
      errors?: unknown[];
    };

    if (json.errors?.length || !json.data?.newSearch?.teachers?.edges) {
      return { found: false, message: "No Rate My Professor results found." };
    }

    const edges = json.data.newSearch.teachers.edges;
    const match = bestProfessorMatch(edges, professorLastName);
    if (!match) {
      return {
        found: false,
        message: `No Rate My Professor profile found for "${professorLastName}" at Johns Hopkins.`,
      };
    }

    return mapRmpNodeToResult(match.node);
  } catch {
    return { found: false, message: "Rate My Professor lookup unavailable." };
  }
}
