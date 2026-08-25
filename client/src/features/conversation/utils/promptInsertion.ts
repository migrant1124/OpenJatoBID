export function replaceDraftWithPrompt(prompt: string) {
  return { text: prompt, caret: prompt.length };
}
