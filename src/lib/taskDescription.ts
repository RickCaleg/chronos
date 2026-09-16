const TASK_LIVE_RE = /^(#\S+)\s*-?\s*(.*)$/;

/** Live-typing version of the paste-autofill rule: a leading "#token" is
 * recognized as the task number as soon as it's typed, no separator needed. */
export function splitTaskDescription(raw: string): { taskNumber: string | null; description: string } {
  const match = raw.match(TASK_LIVE_RE);
  if (match) {
    return { taskNumber: match[1], description: match[2] };
  }
  return { taskNumber: null, description: raw };
}

export function combineTaskDescription(taskNumber: string | null | undefined, description: string): string {
  if (!taskNumber) return description;
  return description ? `${taskNumber} ${description}` : taskNumber;
}
