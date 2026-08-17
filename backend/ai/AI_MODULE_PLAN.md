# Local AI Module Plan

## Goal
Create a local-first AI module that can serve chat, search, file understanding, and assistant workflows without external LLM calls.

## Implemented Now
- Ollama-based local text and vision inference.
- Local startup model pulling for required Ollama models.
- Local fallback embeddings and heuristic keyword extraction.
- Upload-triggered indexing with no Hugging Face dependency.

## Next Phases
1. Job queue and throughput control.
2. Tenant-separated model history and retention policies.
3. Archival/compression for cold files and cold vectors.
4. Admin observability view.
5. Agent workflow surface for chat, file generation, and planner tasks.

## Design Constraints
- No external AI API calls in the runtime path.
- Per-tenant data separation at the storage and retrieval layers.
- Prefer local models first, fall back to deterministic heuristics only when a model is unavailable.
- Keep indexing and archive work asynchronous so user uploads stay fast.
