// Api Manager fork: providers whose FREE models can be told apart in their own
// /models list. For these, built-in model discovery runs even though the
// signed catalog manages the platform: the catalog's rows always win (writes
// are INSERT-only), and only models that pass the platform's free rule are
// offered or registered. A new free model therefore shows up without waiting
// for the monthly catalog snapshot.
//
// No imports on purpose: catalog-sync and builtin-model-discovery both read
// this list, and catalog-sync must not import the discovery service.

export interface FreeTierCandidate {
  id: string;
  isFree?: boolean;
}

export interface FreeTierRule {
  /** Why a model counts as free here, for docs and error messages. */
  rule: string;
  isFree(model: FreeTierCandidate): boolean;
}

// Classifier, guard and speech ids that share a chat provider's /models.
const NOT_GENERAL_CHAT = /(guard|whisper|tts|orpheus|playai|moderation|ocr|embed|rerank)/i;

export const FREE_TIER_DISCOVERY: Readonly<Record<string, FreeTierRule>> = {
  openrouter: {
    rule: 'ids ending in :free',
    isFree: m => /:free$/i.test(m.id),
  },
  kilo: {
    rule: 'ids ending in :free',
    isFree: m => /:free$/i.test(m.id),
  },
  groq: {
    rule: 'every chat model (the whole API is on the free tier)',
    isFree: m => !NOT_GENERAL_CHAT.test(m.id),
  },
  cerebras: {
    rule: 'every chat model (the whole API is on the free tier)',
    isFree: m => !NOT_GENERAL_CHAT.test(m.id),
  },
  mistral: {
    rule: '-latest aliases of chat models (the Experiment plan covers the API)',
    isFree: m => /-latest$/i.test(m.id) && !NOT_GENERAL_CHAT.test(m.id),
  },
  zhipu: {
    rule: 'Flash models (not FlashX)',
    isFree: m => /flash(?!x)/i.test(m.id) && !/^cog(view|video)/i.test(m.id),
  },
};

export function isFreeTierDiscoveryPlatform(platform: string): boolean {
  return Object.prototype.hasOwnProperty.call(FREE_TIER_DISCOVERY, platform);
}

/** Keep only the models the platform's free rule accepts. Platforms without a
 *  rule pass through unchanged. */
export function filterFreeTier<T extends FreeTierCandidate>(platform: string, models: T[]): T[] {
  const rule = isFreeTierDiscoveryPlatform(platform) ? FREE_TIER_DISCOVERY[platform] : undefined;
  return rule ? models.filter(m => rule.isFree(m)) : models;
}
