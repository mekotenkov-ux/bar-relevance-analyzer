# Optional CPU triplet service

> **Deferred experiment (2026-08-14).** This LLM-based extractor is preserved
> for reproducibility, but BAR does not activate it from model URLs alone. Set
> `TRIPLET_ENGINE=llm` explicitly only when intentionally rerunning this experiment.

This service adds evidence-backed semantic relations to BAR reports without loading
an LLM in the web application. It is optional and is intended to run after the normal
lemma/N-gram analysis has selected the most important entities.

The default model is the MIT-licensed `numind/NuExtract-2.0-2B-GGUF` Q4_K_M
checkpoint behind `llama.cpp`. The model is fetched at container startup into a named
Docker volume. Model weights and API keys are never stored in this repository.

## Start on a CPU server

Requirements:

- Docker Engine with Compose v2;
- an x86-64 CPU with AVX2 recommended;
- 4 GB free RAM for the model and 512 MB for the adapter;
- approximately 1 GB of persistent disk for the default quantized model.

```bash
cd services/triplets
cp env.example .env
docker compose up --build
```

The first start downloads the model into the `triplets-model-cache` Docker volume.
The adapter listens at `http://127.0.0.1:8091`; the backend listens at loopback port
`8080`. Check readiness with:

```bash
curl http://127.0.0.1:8091/healthz
```

The default checkpoint is based on a vision-language model, but this service accepts
text only. Compose passes `--no-mmproj`, so llama.cpp does not download or load the
optional 1.33 GB vision projector. The approximately 1 GB language-model GGUF is
used on its own for sentence relation extraction. Remove `--no-mmproj` and budget
the additional disk/RAM only if a future version of this service accepts images.

For production, set a random `TRIPLETS_API_TOKEN` in `.env` and send it as
`Authorization: Bearer <token>`. Do not expose the llama.cpp port publicly.

## Connect the BAR web application

Add the service address and the same token to the project-root `.dev.vars`:

```dotenv
TRIPLET_ENGINE=llm
TRIPLETS_SERVICE_URL=http://127.0.0.1:8091
TRIPLETS_API_TOKEN=replace-with-the-same-random-value
TRIPLET_TIMEOUT_MS=240000
```

Restart the web application after changing `.dev.vars`. The timeout is optional;
keep it high enough for queued CPU inference. If the web application itself runs in
Docker, use an address reachable from that container instead of `127.0.0.1`.

## HTTP contract

`POST /v1/triplets` accepts only bounded, already selected evidence. Sentences are
untrusted page content: the system prompt treats them as data, never as instructions.

```json
{
  "request_id": "report-42",
  "language": "ru",
  "focus_entity_ids": ["e1"],
  "entities": [
    {"id": "e1", "label": "SEO-курсы", "aliases": ["курсы SEO"]}
  ],
  "sentences": [
    {
      "id": "s1",
      "text": "SEO-курсы помогают освоить продвижение сайтов.",
      "entity_ids": ["e1"],
      "source": {"kind": "competitor", "domain": "example.org"}
    }
  ],
  "max_edges": 32
}
```

```json
{
  "request_id": "report-42",
  "model": "NuExtract-2.0-2B-Q4_K_M.gguf",
  "edges": [
    {
      "source_id": "e1",
      "predicate": "помогают освоить",
      "target_label": "продвижение сайтов",
      "sentence_id": "s1",
      "negated": false
    }
  ]
}
```

`target_id` is returned only when the target is another known entity marked in the
same sentence. Otherwise `target_label` is a verbatim discovered target. The adapter
rejects unknown source/sentence IDs, cross-sentence known targets, non-verbatim target
labels, self-relations, malformed JSON, and duplicates.

For the default NuExtract backend the adapter manually sends `# Template:` followed
by the extraction template, as required by the model's GGUF documentation. It does
not rely on `chat_template_kwargs`, which llama.cpp does not apply. NuExtract itself
produces JSON; strict local parsing and evidence validation remain the enforcement
layer, so `TRIPLETS_RESPONSE_FORMAT` defaults to `none`.

Hard limits are 64 known entities, 20 focus entities, 250 deduplicated sentences,
6,000 estimated sentence-evidence tokens, 128 accepted edges, and a 256 KiB HTTP
body. The language-neutral estimate matches the web adapter (`max(words × 1.5,
script-aware character estimate)`: whitespace-poor scripts such as CJK, Thai and
Khmer are counted much more densely. A separate full-context guard (at most 9,000
tokens) also counts entities, aliases, JSON scaffolding and Unicode symbols, and
automatically shrinks when the configured output or per-slot context requires more
room for the template and output.
Environment variables may lower but cannot raise these caps. Only two inference requests run
concurrently by default; excess work waits briefly and then receives HTTP 429 so the
application can retry.

## Use an existing Ollama server

Pull the model outside this repository:

```bash
ollama pull hf.co/numind/NuExtract-2.0-2B-GGUF:Q4_K_M
```

Set these values in `.env`:

```dotenv
TRIPLETS_LLM_BASE_URL=http://host.docker.internal:11434/v1
TRIPLETS_LLM_MODEL=hf.co/numind/NuExtract-2.0-2B-GGUF:Q4_K_M
```

Then start only the adapter so Compose does not start llama.cpp:

```bash
docker compose up --build triplets
```

On Linux, point `TRIPLETS_LLM_BASE_URL` at an address reachable from the container
or add the appropriate `host-gateway` mapping for your Docker installation.

## Swap to a generic Qwen model

Any OpenAI-compatible local server can be used. Set its base URL and exact model
identifier, then disable the NuExtract-specific template:

```dotenv
TRIPLETS_LLM_BASE_URL=http://host.docker.internal:11434/v1
TRIPLETS_LLM_MODEL=qwen-model-name-in-your-server
TRIPLETS_USE_NUEXTRACT_TEMPLATE=false
TRIPLETS_RESPONSE_FORMAT=json_schema
```

If using the bundled llama.cpp service, also change `TRIPLETS_MODEL_SOURCE` to a
GGUF repository/quant supported by `llama.cpp`. Keep at least the default 24,576
total context when using two parallel slots: each slot then has room for the
6,000-token evidence cap, JSON/template overhead, and the bounded output.

## Capacity notes

- Do not run one model process per report. One model process serves a short queue.
- `TRIPLETS_MAX_CONCURRENCY` should normally match `TRIPLETS_LLM_PARALLEL`.
- Increasing parallel slots divides the configured llama.cpp context and raises RAM.
- Context, parallelism, and maximum output are validated together at adapter startup;
  keep their environment values identical to the backend configuration.
- For an 8-vCPU host, start with 2 slots and 8 model threads.
- The adapter intentionally runs one Uvicorn worker so its semaphore is global.
- Put a reverse proxy with its own request-size and rate limits in front of any
  remotely reachable deployment.

The service code is covered by the repository MIT license. The default 2B model is
also published under MIT; replacement model licenses must be checked separately.

Run `node services/triplets/acceptance.mjs` from the project root for a quick,
download-free check of the critical template, limits, and Compose wiring.
