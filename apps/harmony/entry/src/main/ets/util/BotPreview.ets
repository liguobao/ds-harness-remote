import { HarnessTurnSummary } from '../net/HarnessClient';

/** Android Bot inbox: latest visible response or prompt, excluding internal exchange turns. */
export function botOutlinePreview(outline: HarnessTurnSummary[], hidden: Object[]): string {
  for (let i = outline.length - 1; i >= 0; i--) {
    const turn: HarnessTurnSummary = outline[i];
    let isHidden: boolean = false;
    for (const id of hidden) {
      if (String(id) === turn.turnId) { isHidden = true; break; }
    }
    if (isHidden) continue;
    const text: string = turn.response.length > 0 ? turn.response : turn.prompt;
    if (text.length > 0) {
      return text.replace(/^\[(Message from|Reply from|Group chat|Group post from|Bot team setup|Handoff · part|Secret card)(?:[^\r\n]*\]\r?\n|[^\]\r\n]*\])/, '')
        .replace(/\s+/g, ' ').trim().slice(0, 240);
    }
  }
  return '';
}
