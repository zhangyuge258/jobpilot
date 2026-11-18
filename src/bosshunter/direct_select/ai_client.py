"""AI Client for Direct Select: supports multimodal Vision and Text extraction."""

import base64
import json
import re
from typing import Optional
from bosshunter.config import load_config
from bosshunter.ai.credentials import (
    call_anthropic_text,
    get_ai_api_key,
    get_ai_service,
    build_anthropic_client_kwargs,
    resolve_anthropic_model,
    normalize_ai_error,
    get_ai_base_url,
)


def call_ai(prompt: str, max_tokens: int = 4096) -> Optional[str]:
    """通用文本调用."""
    config = load_config()
    try:
        return call_anthropic_text(prompt, config, max_tokens=max_tokens)
    except Exception as e:
        print(f"[DirectSelect] AI call error: {e}")
        return None


def call_ai_vision(image_data_base64: str, media_type: str, prompt: str, max_tokens: int = 4096) -> Optional[str]:
    """多模态视觉调用：支持图片结构化解析."""
    config = load_config()
    ai_cfg = config.get("ai", {}) if isinstance(config, dict) else {}
    provider = ai_cfg.get("provider", "anthropic")

    # 去掉可能存在的 data:image/png;base64, 前缀
    if "," in image_data_base64:
        header, image_data_base64 = image_data_base64.split(",", 1)
        if "image/jpeg" in header:
            media_type = "image/jpeg"
        elif "image/png" in header:
            media_type = "image/png"
        elif "image/webp" in header:
            media_type = "image/webp"

    if provider == "openai_compatible":
        try:
            import httpx
            api_key = get_ai_api_key(config)
            base_url = get_ai_base_url(config) or "https://api.openai.com/v1"
            model = ai_cfg.get("model", "gpt-4o")

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": model,
                "max_tokens": max_tokens,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{media_type};base64,{image_data_base64}"
                                }
                            },
                            {
                                "type": "text",
                                "text": prompt
                            }
                        ]
                    }
                ]
            }
            with httpx.Client(timeout=120.0) as client:
                res = client.post(f"{base_url.rstrip('/')}/chat/completions", headers=headers, json=payload)
                res.raise_for_status()
                data = res.json()
                return data["choices"][0]["message"]["content"]
        except Exception as e:
            print(f"[DirectSelect] OpenAI Vision error: {e}")
            return None
    else:
        # Anthropic provider
        try:
            import anthropic
            api_key = get_ai_api_key(config)
            if not api_key:
                return None
            client = anthropic.Anthropic(**build_anthropic_client_kwargs(config))
            model = resolve_anthropic_model(ai_cfg.get("model", "claude-sonnet-4-6"), config)
            
            message = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_data_base64,
                                }
                            },
                            {
                                "type": "text",
                                "text": prompt
                            }
                        ]
                    }
                ]
            )
            for block in message.content:
                if block.type == "text":
                    return block.text
            return None
        except Exception as e:
            print(f"[DirectSelect] Anthropic Vision error: {e}")
            return None


def clean_json_text(text: str) -> str:
    """清理大模型返回的 JSON markdown 代码块."""
    if not text:
        return ""
    text = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if match:
        return match.group(1).strip()
    return text
