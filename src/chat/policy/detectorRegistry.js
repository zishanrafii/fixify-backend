const { detectWithRegexRules } = require('./detectors/regexDetector');

// REGEX is the only wired-up type today. CUSTOM_FUNCTION/ML_MODEL are
// reserved DetectionRuleType values (see prisma schema) with no detector
// registered yet — detectAll() below simply skips rule types with no
// registered runner, rather than erroring, so adding a type to the enum
// ahead of its detector being built never breaks message sending.
async function detectAll(text) {
  const results = await detectWithRegexRules(text);
  return results;
}

module.exports = { detectAll };
