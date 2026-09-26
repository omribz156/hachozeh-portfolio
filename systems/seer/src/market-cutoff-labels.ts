function toUtcDayStart(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

type ParsedCutoff = {
  at: Date;
  precise: boolean;
};

function parseCutoffLabel(value: string): ParsedCutoff | undefined {
  const match = value.match(/([a-z]+ \d{1,2}, 20\d{2})(?: at (\d{1,2}:\d{2}))?/i);

  if (!match?.[1]) {
    return undefined;
  }

  const parsed = new Date(match[2] ? `${match[1]} ${match[2]} UTC` : `${match[1]} UTC`);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return {
    at: parsed,
    precise: Boolean(match[2])
  };
}

export function hasCutoffPassed(cutoffLabel: string, now = new Date()): boolean {
  const cutoff = parseCutoffLabel(cutoffLabel);

  if (!cutoff) {
    return false;
  }

  if (cutoff.precise) {
    return now.getTime() > cutoff.at.getTime();
  }

  return toUtcDayStart(cutoff.at) < toUtcDayStart(now);
}

export function extractCutoffLabelFromQuestion(question: string): string | undefined {
  return question.match(/\b(?:before|beyond|after|on)\s+([a-z]+ \d{1,2}, 20\d{2}(?: at \d{1,2}:\d{2})?)/i)?.[1]?.trim();
}

export function extractCutoffLabelFromCloseShape(closeShape: string | undefined): string | undefined {
  if (!closeShape) {
    return undefined;
  }

  return closeShape.match(/\bbefore\s+([a-z]+ \d{1,2}, 20\d{2}(?: at \d{1,2}:\d{2})?)/i)?.[1]?.trim();
}
