import inquirer from "inquirer";

type Answers = Record<string, unknown>;
export type FlowStep = Answers | ((promptName: string) => Answers);

interface FlowHandle {
  unconsumed: () => number;
  reset: () => void;
}

function extractPromptName(arg: unknown): string {
  if (Array.isArray(arg) && arg.length > 0 && typeof arg[0] === "object" && arg[0] !== null) {
    const first = arg[0] as { name?: unknown };
    return typeof first.name === "string" ? first.name : "";
  }
  if (typeof arg === "object" && arg !== null) {
    const obj = arg as { name?: unknown };
    return typeof obj.name === "string" ? obj.name : "";
  }
  return "";
}

export function runInteractiveFlow(steps: FlowStep[]): FlowHandle {
  const queue: FlowStep[] = [...steps];
  const mocked = inquirer as jest.Mocked<typeof inquirer>;
  mocked.prompt.mockImplementation((async (questions: unknown) => {
    if (queue.length === 0) {
      throw new Error("interactiveFlow: queue exhausted (unexpected prompt)");
    }
    const step = queue.shift()!;
    if (typeof step === "function") {
      const name = extractPromptName(questions);
      return step(name);
    }
    return step;
  }) as never);

  return {
    unconsumed: () => queue.length,
    reset: () => {
      queue.length = 0;
      mocked.prompt.mockReset();
    },
  };
}
