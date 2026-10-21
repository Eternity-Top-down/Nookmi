export type FeedbackDiffKind = "equal" | "remove" | "add";

export interface FeedbackDiffPart {
  kind: FeedbackDiffKind;
  text: string;
}

export interface FeedbackTextDiff {
  parts: FeedbackDiffPart[];
  additions: number;
  removals: number;
  /** A large changed block exceeded the comparison budget and is shown as a whole. */
  approximate: boolean;
}

// This is a display comparison, not a persisted history. Bound all LCS work across
// a document, including character refinement, so a long rewrite cannot freeze UI.
const MAX_CELLS = 240_000;
const DIRECT_CHARACTER_CELLS = 48_000;

function append(parts: FeedbackDiffPart[], kind: FeedbackDiffKind, text: string) {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last?.kind === kind) last.text += text;
  else parts.push({ kind, text });
}

function sentences(text: string): string[] {
  // Keep delimiters, whitespace and empty-looking lines exactly as written.
  return text.match(/[^。！？；\n]+[。！？；\n]?|[。！？；\n]/gu) ?? [];
}

export function diffFeedbackText(before: string, after: string): FeedbackTextDiff {
  let remainingCells = MAX_CELLS;
  let approximate = false;

  function compareTokens(left: string[], right: string[]): FeedbackDiffPart[] {
    const parts: FeedbackDiffPart[] = [];
    let start = 0;
    while (start < left.length && start < right.length && left[start] === right[start]) start++;
    append(parts, "equal", left.slice(0, start).join(""));
    let leftEnd = left.length;
    let rightEnd = right.length;
    while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
      leftEnd--;
      rightEnd--;
    }
    const a = left.slice(start, leftEnd);
    const b = right.slice(start, rightEnd);
    const cells = (a.length + 1) * (b.length + 1);
    if (!a.length || !b.length) {
      append(parts, "remove", a.join(""));
      append(parts, "add", b.join(""));
    } else if (cells > remainingCells) {
      approximate = true;
      append(parts, "remove", a.join(""));
      append(parts, "add", b.join(""));
    } else {
      remainingCells -= cells;
      const width = b.length + 1;
      const table = new Uint32Array(cells);
      for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
          table[i * width + j] = a[i] === b[j]
            ? 1 + table[(i + 1) * width + j + 1]
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
          append(parts, "equal", a[i++]);
          j++;
        } else if (i < a.length && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
          append(parts, "remove", a[i++]);
        } else append(parts, "add", b[j++]);
      }
    }
    append(parts, "equal", left.slice(leftEnd).join(""));
    return parts;
  }

  const left = Array.from(before);
  const right = Array.from(after);
  let parts: FeedbackDiffPart[];
  if ((left.length + 1) * (right.length + 1) <= DIRECT_CHARACTER_CELLS) {
    parts = compareTokens(left, right);
  } else {
    // Sentence alignment finds unchanged paragraphs first. Refine only changed
    // blocks into code points; Array.from keeps emoji/supplementary CJK intact.
    const coarse = compareTokens(sentences(before), sentences(after));
    parts = [];
    for (let index = 0; index < coarse.length;) {
      if (coarse[index].kind === "equal") {
        append(parts, "equal", coarse[index++].text);
        continue;
      }
      let removed = "";
      let added = "";
      while (index < coarse.length && coarse[index].kind !== "equal") {
        const part = coarse[index++];
        if (part.kind === "remove") removed += part.text;
        else added += part.text;
      }
      for (const part of compareTokens(Array.from(removed), Array.from(added))) {
        append(parts, part.kind, part.text);
      }
    }
  }
  return {
    parts,
    additions: parts.reduce((sum, part) => sum + (part.kind === "add" ? Array.from(part.text).length : 0), 0),
    removals: parts.reduce((sum, part) => sum + (part.kind === "remove" ? Array.from(part.text).length : 0), 0),
    approximate,
  };
}
