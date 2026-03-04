import * as dotenv from "dotenv";
dotenv.config();

import * as readline from "readline";
import { generateText, stepCountIs, ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import chalk from "chalk";
import {
  FilterSisCoursesInput,
  filterSisCoursesInputSchema,
} from "./types/sis";
import { filterSisCourses } from "./tools/filter-sis-courses";

const SYSTEM_PROMPT = `You are a JHU course search assistant. You help students find courses at Johns Hopkins University using the SIS (Student Information System) API.

You have access to a tool called filterSisCourses that searches the SIS course catalog.

Key details about the tool:
- "term" is REQUIRED. Default to "Spring 2026" if the user doesn't specify one.
- "school" must be exactly one of: "Krieger School of Arts and Sciences" or "Whiting School of Engineering"
- "daysOfWeek.days" uses short names: Mon, Tue, Wed, Thu, Fri, Sat, Sun
- "daysOfWeek.match" can be "all" (meets on ALL specified days) or "any" (meets on ANY of the specified days)
- "timeOfDay" can be "morning", "afternoon", or "evening"
- "level" can be "Upper Level Undergraduate" or "Lower Level Undergraduate"
- Results are capped by "limit" (default 20)

When presenting results, format them clearly with course number, title, instructor(s), schedule, and location. Be concise but helpful.`;

const tools = {
  filterSisCourses: {
    description:
      "Search for courses at Johns Hopkins University. Queries the SIS course catalog with optional filters for school, department, instructor, days of week, time of day, credits, level, and more.",
    inputSchema: filterSisCoursesInputSchema,
    execute: async (args: FilterSisCoursesInput) => {
      console.log(chalk.cyan("  [Tool] Searching SIS..."));
      const result = await filterSisCourses(args);
      console.log(
        chalk.cyan(`  [Tool] Found ${result.courses.length} course(s).`),
      );
      return result;
    },
  },
};

async function main() {
  console.log(chalk.bold("\nJHU Course Search Assistant"));
  console.log(
    chalk.gray("Ask about courses at Johns Hopkins. Type /exit to quit.\n"),
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on("SIGINT", () => {
    console.log(chalk.gray("\nGoodbye!"));
    process.exit(0);
  });

  const messages: ModelMessage[] = [];

  const prompt = () => {
    rl.question(chalk.yellow("You: "), async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return prompt();
      if (trimmed === "/exit") {
        console.log(chalk.gray("Goodbye!"));
        rl.close();
        process.exit(0);
      }

      messages.push({ role: "user", content: trimmed });

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await generateText({
          model: openai("gpt-4o-mini"),
          system: SYSTEM_PROMPT,
          messages,
          tools: tools as any,
          stopWhen: stepCountIs(5),
        });

        messages.push(...result.response.messages);
        console.log(chalk.green(`\nAssistant: ${result.text}\n`));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\nError: ${msg}\n`));
      }

      prompt();
    });
  };

  prompt();
}

main();
