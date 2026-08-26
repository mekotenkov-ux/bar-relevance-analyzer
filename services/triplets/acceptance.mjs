import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const app = read("./app.py");
const compose = read("./docker-compose.yml");
const env = read("./env.example");
const readme = read("./README.md");

for (const name of [
  "./app.py",
  "./.dockerignore",
  "./Dockerfile",
  "./docker-compose.yml",
  "./env.example",
  "./requirements.txt",
  "./README.md",
]) {
  const content = read(name);
  assert.ok(content.endsWith("\n"), `${name} must end with a newline`);
  assert.doesNotMatch(content, /[ \t]+\r?$/m, `${name} has trailing whitespace`);
}

assert.match(app, /os\.getenv\("TRIPLETS_RESPONSE_FORMAT", "none"\)/);
assert.match(app, /"# Template:\\n"/);
assert.doesNotMatch(app, /["']chat_template_kwargs["']\s*:/);
assert.match(app, /HARD_MAX_ENTITIES = 64/);
assert.match(app, /HARD_MAX_FOCUS_ENTITIES = 20/);
assert.match(app, /HARD_MAX_SENTENCES = 250/);
assert.match(app, /HARD_MAX_ESTIMATED_INPUT_TOKENS = 6_000/);
assert.match(app, /HARD_MAX_EDGES = 128/);
assert.match(app, /context_per_slot - settings\.max_output_tokens - 1_024/);
assert.match(app, /prompt_tokens = _estimated_prompt_tokens\(context\)/);
assert.match(app, /_backend_url\("models"\)/);
assert.match(app, /_backend_url\("chat\/completions"\)/);

assert.match(compose, /^\s+- --no-mmproj$/m);
assert.doesNotMatch(compose, /^\s+- --mmproj$/m);
assert.match(compose, /TRIPLETS_LLM_CONTEXT_SIZE:-24576/);
assert.match(compose, /TRIPLETS_LLM_PARALLEL:-2/);
assert.match(compose, /TRIPLETS_RESPONSE_FORMAT:-none/);

assert.match(env, /^TRIPLETS_LLM_CONTEXT_SIZE=24576$/m);
assert.match(env, /^TRIPLETS_LLM_PARALLEL=2$/m);
assert.match(env, /^TRIPLETS_RESPONSE_FORMAT=none$/m);
assert.match(readme, /^TRIPLET_TIMEOUT_MS=240000$/m);
assert.doesNotMatch(readme, /TRIPLETS_SERVICE_TIMEOUT_MS/);

console.log("TRIPLET_SERVICE_ACCEPTANCE_OK");
