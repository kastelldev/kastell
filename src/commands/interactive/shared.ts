import inquirer from "inquirer";
import chalk from "chalk";
import { BACK_SIGNAL } from "../../utils/prompts.js";

export const validateRequired = (msg: string) => (v: string) =>
  v.trim().length > 0 ? true : msg;

export const validateScore = (v: string) => {
  const num = Number(v);
  return num >= 0 && num <= 100 ? true : "Enter 0-100";
};

export const validateColonPair = (msg: string) => (v: string) => {
  const parts = v.split(":");
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0
    ? true
    : msg;
};

export function backChoice(): { name: string; value: string } {
  return { name: chalk.dim("← Back"), value: BACK_SIGNAL };
}

export async function promptList(
  message: string,
  choices: Array<{ name: string; value: string }>,
): Promise<string | null> {
  const { answer } = await inquirer.prompt([
    {
      type: "list",
      name: "answer",
      message,
      choices: [...choices, new inquirer.Separator(" "), backChoice()],
      loop: false,
    },
  ]);
  return answer === (BACK_SIGNAL as string) ? null : answer;
}
