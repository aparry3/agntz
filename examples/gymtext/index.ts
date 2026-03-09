/**
 * agent-runner — Gymtext Example
 *
 * A fitness coaching system with multiple agents that share context.
 * This demonstrates the pattern Aaron would use in gymtext:
 *
 * - Chat agent (user-facing entry point)
 * - Fitness updater agent (writes to user context)
 * - Workout generator agent (reads user context + global exercises)
 * - Tools with dynamic context via toolContext
 *
 * Usage:
 *   Set ANTHROPIC_API_KEY in your environment, then:
 *   npx tsx examples/gymtext/index.ts
 */

import { createRunner, defineAgent, defineTool } from "agent-runner";
import { JsonFileStore } from "agent-runner";
import { z } from "zod";

// ═══ Tools ═══

const updateFitness = defineTool({
  name: "update_fitness",
  description:
    "Update the user's fitness profile (goals, preferences, injuries, etc.)",
  input: z.object({
    updates: z.record(z.unknown()).describe("Key-value pairs to update"),
  }),
  async execute(input, ctx) {
    const userId = (ctx as any).user?.id ?? "unknown";
    // Invoke the fitness-updater agent with user-specific context
    const result = await ctx.invoke("fitness-updater", JSON.stringify(input.updates), {
      contextIds: [`users/${userId}/fitness`],
      toolContext: { user: (ctx as any).user },
    });
    return { success: true, result: result.output };
  },
});

const getWorkout = defineTool({
  name: "get_workout",
  description: "Generate a personalized workout for the user",
  input: z.object({
    type: z.enum(["strength", "cardio", "flexibility", "hiit"]).describe("Workout type"),
    duration: z.number().optional().describe("Target duration in minutes"),
  }),
  async execute(input, ctx) {
    const userId = (ctx as any).user?.id ?? "unknown";
    const result = await ctx.invoke("workout-generator", JSON.stringify(input), {
      contextIds: [
        `users/${userId}/fitness`, // user's fitness data
        "global/exercises",        // shared exercise database
      ],
    });
    return { workout: result.output };
  },
});

const logWorkout = defineTool({
  name: "log_workout",
  description: "Log a completed workout for the user",
  input: z.object({
    exercises: z.array(
      z.object({
        name: z.string(),
        sets: z.number().optional(),
        reps: z.number().optional(),
        weight: z.number().optional(),
        duration: z.number().optional().describe("Duration in minutes"),
      })
    ),
    notes: z.string().optional(),
  }),
  async execute(input, ctx) {
    const userId = (ctx as any).user?.id ?? "unknown";
    console.log(`\n📝 Logged workout for user ${userId}:`, JSON.stringify(input, null, 2));
    return {
      logged: true,
      exercises: input.exercises.length,
      timestamp: new Date().toISOString(),
    };
  },
});

// ═══ Agents ═══

const chatAgent = defineAgent({
  id: "chat",
  name: "GymText Coach",
  description: "User-facing fitness coaching assistant",
  systemPrompt: `You are GymText, an AI personal trainer that communicates via text message.
You're friendly, motivating, and knowledgeable about fitness.

Your capabilities:
- Generate personalized workouts using get_workout
- Update user fitness profiles using update_fitness
- Log completed workouts using log_workout

Keep responses conversational and concise (this is a text conversation).
Use emoji naturally. Be encouraging but not over-the-top.`,
  model: { provider: "anthropic", name: "claude-sonnet-4-20250514" },
  tools: [
    { type: "inline", name: "get_workout" },
    { type: "inline", name: "update_fitness" },
    { type: "inline", name: "log_workout" },
  ],
});

const fitnessUpdater = defineAgent({
  id: "fitness-updater",
  name: "Fitness Profile Updater",
  description: "Updates user fitness context based on new information",
  systemPrompt: `You are a fitness data processor. Given updates to a user's fitness profile,
produce a clean, structured summary of the updated profile.

Read any existing context to understand the current state, then merge the updates.
Output the complete updated profile as structured text.`,
  model: { provider: "anthropic", name: "claude-sonnet-4-20250514" },
  contextWrite: true, // Auto-writes output to context
});

const workoutGenerator = defineAgent({
  id: "workout-generator",
  name: "Workout Generator",
  description: "Generates personalized workouts based on user fitness context",
  systemPrompt: `You are a workout programming specialist. Generate detailed, personalized workouts.

Use the user's fitness context to personalize:
- Consider their goals, experience level, injuries, and preferences
- Reference the exercise database for proper exercise selection
- Include warm-up and cool-down
- Specify sets, reps, rest periods, and any modifications

Output a clear, text-friendly workout plan (formatted for SMS/text).`,
  model: { provider: "anthropic", name: "claude-sonnet-4-20250514" },
});

// ═══ Runner Setup ═══

const runner = createRunner({
  store: new JsonFileStore("./examples/gymtext/data"),
  tools: [updateFitness, getWorkout, logWorkout],
});

runner.registerAgent(chatAgent);
runner.registerAgent(fitnessUpdater);
runner.registerAgent(workoutGenerator);

// ═══ Seed some context ═══

// Seed global exercise database
await runner.context.add("global/exercises", {
  contextId: "global/exercises",
  agentId: "application",
  invocationId: "seed",
  content: `## Exercise Database (Sample)
- Barbell Back Squat: compound, legs, intermediate+
- Romanian Deadlift: compound, posterior chain, intermediate+
- Push-ups: compound, chest/triceps, all levels
- Pull-ups: compound, back/biceps, intermediate+
- Dumbbell Lunges: compound, legs, all levels
- Plank: core, isometric, all levels
- Burpees: full body, cardio, all levels
- Kettlebell Swings: posterior chain, power, intermediate+`,
  createdAt: new Date().toISOString(),
});

// Seed user fitness profile
await runner.context.add("users/1/fitness", {
  contextId: "users/1/fitness",
  agentId: "application",
  invocationId: "seed",
  content: `## User Fitness Profile
- Name: Aaron
- Goal: Build strength, maintain cardio fitness
- Experience: Intermediate (3 years training)
- Schedule: 4 days/week
- Equipment: Full gym access
- Injuries: Minor left shoulder impingement (avoid heavy overhead pressing)
- Preferences: Likes compound movements, dislikes machines`,
  createdAt: new Date().toISOString(),
});

// ═══ Simulate a conversation ═══

console.log("🏋️ GymText — Agent Runner Example\n");
console.log("═".repeat(50));

const sessionId = "sess_demo_001";
const toolContext = {
  user: { id: "1", name: "Aaron", plan: "pro" },
};

// Message 1: Ask for a workout
console.log("\n👤 User: Hey! Can you give me a quick strength workout for today?");
const r1 = await runner.invoke("chat", "Hey! Can you give me a quick strength workout for today?", {
  sessionId,
  contextIds: ["users/1"],
  toolContext,
});
console.log(`\n🤖 GymText: ${r1.output}`);
console.log(`   📊 ${r1.usage.totalTokens} tokens | ${r1.duration}ms | ${r1.toolCalls.length} tool calls`);

console.log("\n" + "═".repeat(50));

// Message 2: Follow up
console.log("\n👤 User: That looks great. Can you also note that I've been dealing with some knee soreness lately?");
const r2 = await runner.invoke(
  "chat",
  "That looks great. Can you also note that I've been dealing with some knee soreness lately?",
  { sessionId, contextIds: ["users/1"], toolContext }
);
console.log(`\n🤖 GymText: ${r2.output}`);
console.log(`   📊 ${r2.usage.totalTokens} tokens | ${r2.duration}ms | ${r2.toolCalls.length} tool calls`);

// Cleanup
await runner.shutdown();
console.log("\n✅ Done!");
