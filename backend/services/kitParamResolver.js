// backend/services/kitParamResolver.js
//
// Tiny template resolver for the Kit DSL. Lets a Kit manifest declare
// per-step parameter wiring so a scout's output can flow into a
// negotiator's input without each skill having to read the same shared
// blob and self-select.
//
// Template syntax — used INSIDE the value of a `params` map. Anything
// not starting with `$` is passed through unchanged.
//
//   "$prev"               ← entire previous step's result
//   "$prev.items[0].title"
//   "$0.items[0].url"     ← step N's result, 0-based
//   "$preset.target_price"
//   "$mission.poster_wallet"
//
// Object + array values are walked recursively so a nested template
// inside a list still resolves.
//
// Pure. No I/O. Exported and unit-tested in isolation.

/** Walk a dot+bracket path into a nested object. Returns undefined on
 *  any null hop — a missing reference does NOT throw, so a downstream
 *  skill sees `undefined` and can decide what to do. Throwing here
 *  would freeze the entire crew on a typo. */
function getPath(obj, path) {
  if (obj == null) return undefined;
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Resolve a single template string against the runtime env. Returns
 *  the substituted value (could be any JSON type) OR the input string
 *  unchanged if it doesn't look like a template. */
function resolveTemplate(value, env) {
  if (typeof value !== "string") return value;
  if (!value.startsWith("$"))    return value;

  // "$root" or "$root.path.subpath"
  const m = value.match(/^\$([a-zA-Z0-9_]+)(?:\.(.*))?$/);
  if (!m) return value;
  const [, root, path] = m;

  let base;
  if (root === "prev")          base = env.results[env.results.length - 1];
  else if (root === "preset")   base = env.preset;
  else if (root === "mission")  base = env.mission;
  else if (/^\d+$/.test(root))  base = env.results[Number(root)];
  else return value; // unrecognized root → literal

  return path ? getPath(base, path) : base;
}

/** Walk an arbitrarily-nested params object/array and resolve every
 *  template string against env. Pure — does not mutate input. */
function resolveParams(params, env) {
  if (params == null) return params;
  if (typeof params === "string") return resolveTemplate(params, env);
  if (Array.isArray(params))      return params.map((v) => resolveParams(v, env));
  if (typeof params === "object") {
    const out = {};
    for (const [k, v] of Object.entries(params)) out[k] = resolveParams(v, env);
    return out;
  }
  return params;
}

/** Factory that returns a `resolveStepParams(stepCtx)` callback the
 *  crewOrchestrator can invoke. The factory closes over the static env
 *  (mission, preset) so the orchestrator only has to pass the
 *  per-step priorResults. */
function makeStepResolver({ mission, preset }) {
  return function resolveStepParams({ step, priorResults }) {
    const env = {
      mission: mission || {},
      preset:  preset  || {},
      results: priorResults || [],
    };
    return resolveParams(step.params, env);
  };
}

module.exports = { resolveTemplate, resolveParams, makeStepResolver, getPath };
