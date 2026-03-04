import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { generateText, tool, stepCountIs, ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import chalk from "chalk";
import { z } from "zod";
import {
  courseSchema,
  courseSearchParamsSchema,
  generateDaysOfWeekParamsSchema,
  generateDaysOfWeek,
} from "./types/sis";
import { filterSisCourses } from "./tools/filter-sis-courses";

// --- Session log ---

interface StepLog {
  finishReason: string;
  toolCalls?: Array<{ toolName: string; input: unknown }>;
  toolResults?: Array<{ toolName: string; output: unknown }>;
  text?: string;
}

interface TurnLog {
  timestamp: string;
  userMessage: string;
  steps: StepLog[];
  assistantResponse: string;
  error?: string;
}

interface SessionLog {
  sessionStart: string;
  systemPrompt: string;
  turns: TurnLog[];
}

const LOGS_DIR = path.resolve(__dirname, "..", "logs");

function initSessionLog(systemPrompt: string): SessionLog {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  return {
    sessionStart: new Date().toISOString(),
    systemPrompt,
    turns: [],
  };
}

function writeSessionLog(log: SessionLog): void {
  const timestamp = log.sessionStart.replace(/[:.]/g, "-");
  const filePath = path.join(LOGS_DIR, `demo-${timestamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(log, null, 2));
  console.log(chalk.gray(`  [Log] Session saved to ${filePath}`));
}

// --- Prompt & tools ---

const zodSchemaToString = (schema: z.ZodObject<z.ZodRawShape>) => {
  return Object.entries(schema.shape)
    .map(([key, value]) => {
      const description =
        (value as z.ZodType)._def.description || "No description available";

      if (value instanceof z.ZodEnum) {
        const enumValues = (
          value as z.ZodEnum<[string, ...string[]]>
        )._def.values.join(", ");
        return `${key}: ${description} (Possible values: ${enumValues})`;
      }

      return `${key}: ${description}`;
    })
    .join("\n");
};

const SYSTEM_PROMPT = `You are a Course Search Assistant for Johns Hopkins University (JHU). Your primary goal is to help students, faculty, and staff find courses by interacting with the JHU Course Search API in a natural, conversational manner.

Most of the time, you'll call the \`getClasses\` function to search for courses. The \`getClasses\` function returns a list of courses, each with the following attributes:

"""
${zodSchemaToString(courseSchema)}
"""

If you need to filter by specific days of the week (e.g., Monday, Wednesday, Friday), first convert human-readable days into the proper code using the \`generateDaysOfWeek\` function, then pass that encoded value to \`getClasses\`.

# Conversation Guidelines

1. BE CONVERSATIONAL
   - Engage in a friendly, natural tone.
   - Ask clarifying questions when needed.
   - Show familiarity with JHU's academic context and terminology.

2. COLLECT INFORMATION EFFICIENTLY
   - Don't ask for all parameters at once.
   - Focus on what the user has already provided (e.g., "I'm looking for a writing intensive course").
   - Ask necessary follow-up questions if more details are required.

3. RETRY ON FAILURE
   - If a search fails to return results, or the results don't meet the user's needs, suggest alternative search criteria.
   - Ask the user if they want to try again with different parameters.
   - For example, if searching for courses taught by a specific professor yields no results, ask if they want to search by course title or department instead. Or if they want to search using just the professor's last name.

4. UNDERSTAND ACADEMIC CONTEXT
   - Recognize common terms (e.g., "undergraduate," "grad," "Fall 2024").
   - Be aware that JHU has multiple schools (e.g., Whiting School of Engineering, Krieger School of Arts and Sciences).

5. PROVIDE HELPFUL RESPONSES
   - Present course information clearly (e.g., course title, time, location, availability).
   - Highlight important details (e.g., if a course is full, if it requires special permission).
   - Suggest alternatives if a particular course is unavailable or doesn't meet the user's criteria.

# Example Interactions

**User**: "I'm looking for a writing intensive course for next semester."

**Assistant**: "I can help you find writing intensive courses. Which semester are you interested in (Fall 2025, Spring 2026, etc.)?"

---

**User**: "Are there any machine learning classes in the morning?"

**Assistant**: "Sure! I'll look for machine learning courses with morning time slots. Are you focusing on a particular school, such as the Whiting School of Engineering?"`;

const tools = {
  getClasses: tool({
    description:
      "Get classes from the JHU Course Search API based on search parameters",
    inputSchema: courseSearchParamsSchema,
    execute: async (params) => {
      console.log(chalk.cyan("  [Tool] Searching SIS..."));
      console.log(chalk.gray(`  [Tool] Params: ${JSON.stringify(params)}`));
      const result = await filterSisCourses(params);
      console.log(
        chalk.cyan(`  [Tool] Found ${result.courses.length} course(s).`),
      );
      return result;
    },
  }),
  generateDaysOfWeek: tool({
    description: "Generate encoded string for days of week parameter",
    inputSchema: generateDaysOfWeekParamsSchema,
    execute: async (params) => {
      const encoded = generateDaysOfWeek(params);
      console.log(chalk.cyan(`  [Tool] Encoded days: ${encoded}`));
      return encoded;
    },
  }),
};

// --- Main ---

async function main() {
  console.log(chalk.bold("\nJHU Course Search Assistant"));
  console.log(
    chalk.gray("Ask about courses at Johns Hopkins. Type /exit to quit.\n"),
  );

  const sessionLog = initSessionLog(SYSTEM_PROMPT);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const shutdown = () => {
    writeSessionLog(sessionLog);
    console.log(chalk.gray("Goodbye!"));
    process.exit(0);
  };

  rl.on("SIGINT", () => {
    console.log("");
    shutdown();
  });

  const messages: ModelMessage[] = [];

  const prompt = () => {
    rl.question(chalk.yellow("You: "), async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return prompt();
      if (trimmed === "/exit") {
        rl.close();
        shutdown();
        return;
      }

      messages.push({ role: "user", content: trimmed });

      const turnLog: TurnLog = {
        timestamp: new Date().toISOString(),
        userMessage: trimmed,
        steps: [],
        assistantResponse: "",
      };

      try {
        const result = await generateText({
          model: openai("gpt-4o"),
          system: SYSTEM_PROMPT,
          messages,
          tools,
          temperature: 0,
          stopWhen: stepCountIs(15),
          onStepFinish: ({ text, toolCalls, toolResults, finishReason }) => {
            const stepLog: StepLog = { finishReason };

            console.log(chalk.gray(`  [Step] Finish reason: ${finishReason}`));

            if (toolCalls && toolCalls.length > 0) {
              stepLog.toolCalls = toolCalls.map((tc) => ({
                toolName: tc.toolName,
                input: tc.input,
              }));
              for (const tc of toolCalls) {
                console.log(
                  chalk.gray(
                    `  [Step] Tool call: ${tc.toolName}(${JSON.stringify(tc.input)})`,
                  ),
                );
              }
            }

            if (toolResults && toolResults.length > 0) {
              stepLog.toolResults = toolResults.map((tr) => ({
                toolName: tr.toolName,
                output: tr.output,
              }));
              for (const tr of toolResults) {
                const summary =
                  tr.output &&
                  typeof tr.output === "object" &&
                  "courses" in tr.output
                    ? `${(tr.output as { courses: unknown[] }).courses.length} course(s)`
                    : JSON.stringify(tr.output).substring(0, 100);
                console.log(chalk.gray(`  [Step] Tool result: ${summary}`));
              }
            }

            if (text) {
              stepLog.text = text;
              console.log(
                chalk.gray(`  [Step] Text: ${text.substring(0, 100)}...`),
              );
            }

            turnLog.steps.push(stepLog);
          },
        });

        messages.push(...result.response.messages);
        turnLog.assistantResponse = result.text;
        console.log(chalk.green(`\nAssistant: ${result.text}\n`));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        turnLog.error = msg;
        console.error(chalk.red(`\nError: ${msg}\n`));
      }

      sessionLog.turns.push(turnLog);
      prompt();
    });
  };

  prompt();
}

main();
