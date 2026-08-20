// Reserved for a future ML-based detector (e.g. a small classifier model for
// contact-info sharing that regex alone can't catch — obfuscated numbers
// like "o1seven..." written out in words, etc). Not implemented in v1.
// When built, it should export the same shape as regexDetector.js:
//   async function detect(text) -> [{ ruleKey, matchedText }]
// and get registered in ../detectorRegistry.js under DetectionRuleType.ML_MODEL.

async function detect() {
  throw new Error('ML_MODEL detector is not implemented yet');
}

module.exports = { detect };
