export const MS_PER_DAY = 86_400_000;

export function formatRelativeTime(date: Date | string): string {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / MS_PER_DAY);
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}