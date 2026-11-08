/**
 * Glob patterns for ownership -- the wildcards Ownership Rules and
 * CODEOWNERS lines are written in. In a path glob `*` matches within one
 * path segment, `**` across segments, and `?` one character other than `/`.
 * In a text glob, for modules, URLs and tags, `*` matches any run of
 * characters and `?` any one. Every other character matches itself.
 */

const SPECIAL = /[.+^${}()|[\]\\]/g;
const DOUBLE_STAR_SEGMENT = '**/';

// --- helpers ---

function literal(text: string): string {
  return text.replace(SPECIAL, '\\$&');
}

function textGlobSource(glob: string): string {
  return Array.from(glob, (character) => {
    if (character === '*') return '.*';
    if (character === '?') return '.';
    return literal(character);
  }).join('');
}

// --- exports ---

/** The regular-expression body of a path glob; the caller anchors it. */
export function pathGlobSource(glob: string): string {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob.charAt(index);
    if (glob.startsWith(DOUBLE_STAR_SEGMENT, index)) {
      source += '(?:.*/)?';
      index += DOUBLE_STAR_SEGMENT.length - 1;
    } else if (glob.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += literal(character);
  }
  return source;
}

/** Whether the whole path, or the part of it after any `/`, matches the path glob. */
export function matchesPathGlob(glob: string, path: string): boolean {
  return new RegExp(`^(?:.*/)?${pathGlobSource(glob.replace(/^\/+/, ''))}$`).test(path);
}

/** Whether the whole text matches the text glob. */
export function matchesTextGlob(glob: string, text: string): boolean {
  return new RegExp(`^${textGlobSource(glob)}$`, 's').test(text);
}
