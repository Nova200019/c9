#!/bin/sh
set -eu

OLLAMA_MODELS_TO_PULL=${OLLAMA_PULL_MODELS:-"${OLLAMA_TEXT_MODEL:-qwen2.5:7b-instruct} ${OLLAMA_VISION_MODEL:-llava:7b} ${OLLAMA_EMBEDDING_MODEL:-nomic-embed-text}"}

ollama serve >/tmp/ollama-start.log 2>&1 &
OLLAMA_PID=$!
trap 'kill "$OLLAMA_PID" 2>/dev/null || true' INT TERM EXIT

until ollama list >/dev/null 2>&1; do
  sleep 1
done

for model in $OLLAMA_MODELS_TO_PULL; do
  if [ -n "$model" ]; then
    ollama pull "$model" || true
  fi
done

wait "$OLLAMA_PID"
