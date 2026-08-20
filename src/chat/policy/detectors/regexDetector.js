const prisma = require('../../../config/db');

// Returns [{ ruleKey, matchedText }] for every active REGEX rule that hits.
// Patterns are stored as strings in DetectionRule.pattern and compiled here
// at call time — no code change needed to add/edit/disable a rule.
async function detectWithRegexRules(text) {
  if (!text) return [];

  const rules = await prisma.detectionRule.findMany({ where: { isActive: true, type: 'REGEX' } });
  const matches = [];

  for (const rule of rules) {
    if (!rule.pattern) continue;
    try {
      const regex = new RegExp(rule.pattern, 'gi');
      const found = text.match(regex);
      if (found && found.length) {
        matches.push({ ruleKey: rule.key, matchedText: found[0] });
      }
    } catch (err) {
      console.error(`[regexDetector] invalid pattern for rule "${rule.key}":`, err.message);
    }
  }

  return matches;
}

module.exports = { detectWithRegexRules };
