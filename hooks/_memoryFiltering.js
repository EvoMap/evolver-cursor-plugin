// _memoryFiltering.js
// Shared memory filtering logic for evolver hooks (platform-independent).
//
// Responsibility: Filter evolution memory outcomes to reduce noise in Claude/Codex context.
// - Removes failed outcomes (no learning value)
// - Filters low-confidence outcomes (score < 0.5)
// - Enforces time bounds (< 7 days old)
// - Limits result size (max 3 outcomes)

const DEFAULT_MIN_SCORE = 0.5;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_MAX_OUTCOMES = 3;

function filterRelevantOutcomes(entries, opts = {}) {
  const minScore = opts.minScore !== undefined ? opts.minScore : DEFAULT_MIN_SCORE;
  const maxAgeMs = opts.maxAgeMs !== undefined ? opts.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const maxOutcomes = opts.maxOutcomes !== undefined ? opts.maxOutcomes : DEFAULT_MAX_OUTCOMES;

  const now = Date.now();

  return entries
    .filter(e => {
      // Only keep 'success' outcomes (failed ones don't provide learning value)
      if (e.outcome?.status !== 'success') return false;
      // Only keep high-confidence outcomes
      if ((e.outcome?.score ?? 0) < minScore) return false;
      // Only keep recent outcomes
      const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
      if (now - ts > maxAgeMs) return false;
      return true;
    })
    .slice(-maxOutcomes);
}

module.exports = { filterRelevantOutcomes, DEFAULT_MIN_SCORE, DEFAULT_MAX_AGE_MS, DEFAULT_MAX_OUTCOMES };
