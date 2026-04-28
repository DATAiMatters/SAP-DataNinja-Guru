"""Pluggable LLM client abstraction with per-role routing.

Each agent role in the propose-domain pipeline (extractor, reviewer,
repair) can be backed by a different model — Anthropic, a local Ollama
instance, an OpenAI-compatible endpoint (LM Studio, Together,
Fireworks, HuggingFace Inference Endpoint), or anything else that
speaks the OpenAI Chat Completions API.

Role configuration via environment variables:

    MODEL_EXTRACTOR  — the heavy structured-extraction agent
    MODEL_REVIEWER   — the second-opinion auditor
    MODEL_REPAIR     — the targeted fix agent
    MODEL_VISION     — vision PDF reader (ticket 38)

Spec format:

    anthropic:<model_name>                       (Anthropic API)
    openai:<model_name>@<base_url>               (any OpenAI-compatible endpoint)
    ollama:<model_name>                          (shortcut: localhost:11434/v1)

Examples:

    MODEL_EXTRACTOR=anthropic:claude-opus-4-7
    MODEL_REVIEWER=ollama:llama3.1:8b
    MODEL_REPAIR=openai:meta-llama/Llama-3.3-70B-Instruct-Turbo@https://api.together.xyz/v1

If a role's env var is unset, the default (Anthropic Opus) is used —
preserving the previous single-provider behavior.
"""
from __future__ import annotations

import os
import sys
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

# Default model spec when a role-specific env var isn't set. Keeps the
# pre-ticket-37 behavior intact for users who haven't opted into routing.
DEFAULT_MODEL_SPEC = "anthropic:claude-opus-4-7"

# When the ANTHROPIC_MODEL_PROPOSE / ANTHROPIC_MODEL legacy env vars are
# set, they win for the EXTRACTOR/REPAIR roles (those scripts read them
# directly today). New per-role MODEL_* vars take precedence over both.
_LEGACY_ANTHROPIC_MODEL = (
    os.environ.get("ANTHROPIC_MODEL_PROPOSE") or os.environ.get("ANTHROPIC_MODEL")
)


@dataclass
class LLMResponse:
    """Normalized response shape across providers. The job runner sniffs
    `usage:` lines from stdout to aggregate cost, so we always emit one
    in the documented format regardless of which backend produced the
    response."""
    text: str
    input_tokens: int
    output_tokens: int
    model: str


class LLMClient(ABC):
    """One client per role per propose run. Streaming is hidden inside —
    callers don't need to know whether the underlying API streamed or
    not. We always stream when max_tokens is large because the Anthropic
    SDK enforces it for >10-minute calls; smaller calls fall through to
    the simpler non-streaming path.
    """

    @property
    @abstractmethod
    def model_name(self) -> str:
        ...

    @abstractmethod
    def complete(
        self,
        system: str,
        user: str,
        max_tokens: int,
    ) -> LLMResponse:
        ...

    def complete_with_image(
        self,
        system: str,
        user: str,
        image_bytes: bytes,
        image_mime: str,
        max_tokens: int,
    ) -> LLMResponse:
        """Vision call: same shape as `complete` but with one image
        attached to the user message. Default raises — backends opt in
        by overriding. Used by ticket 38 (vision PDF extraction)."""
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support vision input"
        )

    def emit_usage(self, resp: LLMResponse) -> None:
        """Standard machine-parsable usage line. The web/lib/jobs.ts
        tailer scrapes this with USAGE_RE; same format regardless of
        which backend produced the call."""
        print(
            f"  usage: input={resp.input_tokens} output={resp.output_tokens} model={resp.model}",
            flush=True,
        )


# ---------------------------------------------------------------------
# Anthropic backend
# ---------------------------------------------------------------------

class AnthropicLLMClient(LLMClient):
    def __init__(self, model: str):
        self._model = model

    @property
    def model_name(self) -> str:
        return self._model

    def complete(self, system: str, user: str, max_tokens: int) -> LLMResponse:
        try:
            from anthropic import Anthropic
        except ImportError:
            sys.exit("missing dep: anthropic. install: pip install -r scripts/requirements.txt")
        if not os.environ.get("ANTHROPIC_API_KEY"):
            sys.exit("ANTHROPIC_API_KEY not set in env")
        client = Anthropic()
        # Stream for any call where max_tokens could approach the SDK's
        # 10-minute non-streaming threshold. Threshold is conservative:
        # anything above 8K we just stream by default; cheap for the
        # caller, avoids the SDK throwing partway through a long propose.
        if max_tokens > 8000:
            with client.messages.stream(
                model=self._model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            ) as stream:
                for _ in stream.text_stream:
                    pass
                final = stream.get_final_message()
            return LLMResponse(
                text=_strip_code_fence(final.content[0].text.strip()),
                input_tokens=getattr(final.usage, "input_tokens", 0) or 0,
                output_tokens=getattr(final.usage, "output_tokens", 0) or 0,
                model=self._model,
            )
        else:
            resp = client.messages.create(
                model=self._model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            return LLMResponse(
                text=_strip_code_fence(resp.content[0].text.strip()),
                input_tokens=getattr(resp.usage, "input_tokens", 0) or 0,
                output_tokens=getattr(resp.usage, "output_tokens", 0) or 0,
                model=self._model,
            )

    def complete_with_image(
        self,
        system: str,
        user: str,
        image_bytes: bytes,
        image_mime: str,
        max_tokens: int,
    ) -> LLMResponse:
        try:
            from anthropic import Anthropic
        except ImportError:
            sys.exit("missing dep: anthropic. install: pip install -r scripts/requirements.txt")
        import base64
        client = Anthropic()
        b64 = base64.standard_b64encode(image_bytes).decode("ascii")
        # Anthropic's content-block format: an image block followed by a
        # text block in the user turn. Streaming again because vision +
        # high token budget is exactly the case the SDK would refuse.
        with client.messages.stream(
            model=self._model,
            max_tokens=max_tokens,
            system=system,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image_mime,
                            "data": b64,
                        },
                    },
                    {"type": "text", "text": user},
                ],
            }],
        ) as stream:
            for _ in stream.text_stream:
                pass
            final = stream.get_final_message()
        return LLMResponse(
            text=_strip_code_fence(final.content[0].text.strip()),
            input_tokens=getattr(final.usage, "input_tokens", 0) or 0,
            output_tokens=getattr(final.usage, "output_tokens", 0) or 0,
            model=self._model,
        )


# ---------------------------------------------------------------------
# OpenAI-compatible backend (Ollama, LM Studio, Together, Fireworks,
# HuggingFace TGI, vLLM, anything else that speaks /v1/chat/completions)
# ---------------------------------------------------------------------

class OpenAICompatLLMClient(LLMClient):
    def __init__(self, model: str, base_url: str, api_key: Optional[str] = None):
        self._model = model
        self._base_url = base_url
        # Local servers (Ollama, LM Studio) don't require a key but the
        # OpenAI SDK insists on one. Use a placeholder when the user
        # didn't supply one and the base URL looks local.
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY") or "no-key-needed"

    @property
    def model_name(self) -> str:
        return self._model

    def complete(self, system: str, user: str, max_tokens: int) -> LLMResponse:
        try:
            from openai import OpenAI
        except ImportError:
            sys.exit(
                "missing dep: openai. install: pip install -r scripts/requirements.txt\n"
                "(needed for local Ollama / OpenAI-compatible endpoints — Anthropic-only "
                "users can ignore.)"
            )
        client = OpenAI(base_url=self._base_url, api_key=self._api_key)
        # Always stream; many local servers are slow enough that
        # non-streaming requests can hit gateway timeouts. Streaming
        # also gives us a more responsive feeling in the job log even
        # though we drain silently here.
        stream = client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=max_tokens,
            stream=True,
            stream_options={"include_usage": True},
        )
        chunks: list[str] = []
        usage_in = 0
        usage_out = 0
        for chunk in stream:
            # Some servers emit chunks with empty choices when usage is
            # being reported on the final tick; guard against that.
            if chunk.choices:
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    chunks.append(delta.content)
            if getattr(chunk, "usage", None):
                usage_in = chunk.usage.prompt_tokens or 0
                usage_out = chunk.usage.completion_tokens or 0
        return LLMResponse(
            text=_strip_code_fence("".join(chunks).strip()),
            input_tokens=usage_in,
            output_tokens=usage_out,
            model=self._model,
        )

    def complete_with_image(
        self,
        system: str,
        user: str,
        image_bytes: bytes,
        image_mime: str,
        max_tokens: int,
    ) -> LLMResponse:
        try:
            from openai import OpenAI
        except ImportError:
            sys.exit("missing dep: openai. install: pip install -r scripts/requirements.txt")
        import base64
        client = OpenAI(base_url=self._base_url, api_key=self._api_key)
        b64 = base64.standard_b64encode(image_bytes).decode("ascii")
        # OpenAI-compat vision uses an image_url content block. Ollama's
        # implementation accepts data URIs (data:image/png;base64,...).
        # Local vision models (Qwen2-VL via Ollama, LlavaR, etc.) all
        # follow this same content shape.
        data_uri = f"data:{image_mime};base64,{b64}"
        stream = client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_uri}},
                        {"type": "text", "text": user},
                    ],
                },
            ],
            max_tokens=max_tokens,
            stream=True,
            stream_options={"include_usage": True},
        )
        chunks: list[str] = []
        usage_in = 0
        usage_out = 0
        for chunk in stream:
            if chunk.choices:
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    chunks.append(delta.content)
            if getattr(chunk, "usage", None):
                usage_in = chunk.usage.prompt_tokens or 0
                usage_out = chunk.usage.completion_tokens or 0
        return LLMResponse(
            text=_strip_code_fence("".join(chunks).strip()),
            input_tokens=usage_in,
            output_tokens=usage_out,
            model=self._model,
        )


# ---------------------------------------------------------------------
# Spec parsing + role routing
# ---------------------------------------------------------------------

def _strip_code_fence(raw: str) -> str:
    """Some local models stubbornly wrap output in ```yaml ... ``` even
    when told not to. Strip the fence so callers always see clean YAML.
    """
    import re
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:yaml)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    return raw


def parse_spec(spec: str) -> LLMClient:
    """Turn a spec string into a concrete client.

    Supported forms:
      anthropic:<model>
      ollama:<model>                 (shortcut for openai: with localhost)
      openai:<model>@<base_url>      (Together, LM Studio, vLLM, etc.)
    """
    if ":" not in spec:
        raise ValueError(
            f"invalid model spec {spec!r}: expected '<provider>:<model>[@<base_url>]'"
        )
    provider, rest = spec.split(":", 1)

    if provider == "anthropic":
        return AnthropicLLMClient(model=rest.strip())

    if provider == "ollama":
        # Convenience shortcut: the user almost certainly means localhost.
        # Override OLLAMA_HOST to point at a remote box if needed.
        host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
        # Ollama serves the OpenAI-compat API at /v1.
        base_url = host.rstrip("/") + "/v1"
        return OpenAICompatLLMClient(model=rest.strip(), base_url=base_url)

    if provider == "openai":
        if "@" not in rest:
            raise ValueError(
                f"openai: spec needs @<base_url>: got {spec!r}\n"
                "Example: openai:llama3.3-70b@https://api.together.xyz/v1"
            )
        model, base_url = rest.rsplit("@", 1)
        return OpenAICompatLLMClient(
            model=model.strip(),
            base_url=base_url.strip(),
        )

    raise ValueError(
        f"unknown provider {provider!r} in spec {spec!r}; "
        "supported: anthropic, ollama, openai"
    )


def client_for_role(role: str) -> LLMClient:
    """Resolve a role name to a concrete client.

    Lookup order:
      1. MODEL_<ROLE>     (per-role override; the new one)
      2. ANTHROPIC_MODEL  (legacy global; respected for back-compat)
      3. DEFAULT_MODEL_SPEC

    `role` is uppercase by convention: EXTRACTOR, REVIEWER, REPAIR, VISION.
    """
    role_env = f"MODEL_{role.upper()}"
    spec = os.environ.get(role_env)
    if not spec and _LEGACY_ANTHROPIC_MODEL and role.upper() in {"EXTRACTOR", "REPAIR"}:
        spec = f"anthropic:{_LEGACY_ANTHROPIC_MODEL}"
    if not spec:
        spec = DEFAULT_MODEL_SPEC
    return parse_spec(spec)
