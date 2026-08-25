export function mergePromptAtSelection(current: string, prompt: string, start?: number, end?: number) {
  const hasSelection = Number.isInteger(start) && Number.isInteger(end)
    && Number(start) >= 0 && Number(end) >= Number(start) && Number(end) <= current.length;
  if (hasSelection) {
    const selectionStart = Number(start);
    const selectionEnd = Number(end);
    return { text: `${current.slice(0, selectionStart)}${prompt}${current.slice(selectionEnd)}`, caret: selectionStart + prompt.length };
  }
  const text = `${current}${current ? '\n\n' : ''}${prompt}`;
  return { text, caret: text.length };
}
