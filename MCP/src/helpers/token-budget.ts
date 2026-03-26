/**
 * Token budget enforcement for tool responses.
 * Uses chars/4 heuristic for token estimation.
 */

export const HARD_CAP = 8000;

export function estimateTokens(content: unknown): number {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  return Math.ceil(str.length / 4);
}

export interface BudgetCheck {
  over: boolean;
  estimated: number;
  cap: number;
}

export function isOverBudget(content: unknown): BudgetCheck {
  const estimated = estimateTokens(content);
  return { over: estimated > HARD_CAP, estimated, cap: HARD_CAP };
}

export type TruncationStrategy = 'trim' | 'summarize';

export function truncateToBudget(
  content: string,
  strategy: TruncationStrategy = 'trim',
): string {
  const maxChars = HARD_CAP * 4;
  if (content.length <= maxChars) return content;

  if (strategy === 'trim') {
    return content.slice(0, maxChars);
  }

  // For 'summarize', just trim — actual summarization is handled by response-summarizer
  return content.slice(0, maxChars);
}
