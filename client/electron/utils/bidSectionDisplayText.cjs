function normalizeBidSectionDisplayText(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:^|\s)\|?\s*(?:L)?\d{1,8}\s*\|/gi, ' ')
    .replace(/\|+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  normalizeBidSectionDisplayText,
};
