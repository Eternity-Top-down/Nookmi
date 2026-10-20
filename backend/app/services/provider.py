"""Minimal OpenAI-compatible chat provider with safe error messages."""
from __future__ import annotations

import httpx

from .settings import SettingsStore, SettingsUnavailable


class ProviderError(Exception):
    def __init__(self, message: str, status: int = 502):
        self.message = message
        self.status = status
        super().__init__(message)


class AIProvider:
    def __init__(self, settings: SettingsStore, transport: httpx.BaseTransport | None = None):
        self.settings = settings
        self.transport = transport

    def complete(self, messages: list[dict[str, str]]) -> dict[str, str]:
        try:
            settings = self.settings.read_private()
        except SettingsUnavailable:
            raise ProviderError("AI 设置无法读取，请检查设置后重试。", 503) from None
        if not self.settings.public(settings)["configured"]:
            raise ProviderError("请先在 AI 设置中填写 API 地址和模型；远程服务还需配置 API Key。", 503)
        endpoint = settings["baseUrl"].rstrip("/")
        if not endpoint.endswith("/chat/completions"):
            endpoint += "/chat/completions"
        try:
            with httpx.Client(
                timeout=httpx.Timeout(60.0, connect=10.0),
                follow_redirects=False, trust_env=False, transport=self.transport,
            ) as client:
                response = client.post(
                    endpoint,
                    headers={
                        "Content-Type": "application/json",
                        **({"Authorization": f"Bearer {settings['apiKey']}"} if settings["apiKey"] else {}),
                    },
                    json={"model": settings["model"], "messages": messages},
                )
            if response.status_code in (401, 403):
                raise ProviderError("AI 服务拒绝认证，请检查 API Key 和模型访问权限。", 502)
            if response.status_code == 429:
                raise ProviderError("AI 服务请求过于频繁或额度不足，请稍后重试并检查服务额度。", 429)
            if 300 <= response.status_code < 400:
                raise ProviderError("AI 服务要求重定向；为保护密钥未自动跳转，请填写最终 API 地址。")
            if response.status_code >= 400:
                raise ProviderError("AI 服务暂时未能完成请求，请检查服务状态、模型名称和 API 地址后重试。")
            if len(response.content) > 1_000_000:
                raise ProviderError("AI 服务响应过大，请调整服务设置后重试。")
            body = response.json()
            content = body["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip() or len(content) > 10_000:
                raise ProviderError("AI 服务未返回有效反馈正文，请检查模型是否支持文本对话。")
            content.encode("utf-8")
            # A provider might reflect request headers in a successful response.
            # Never let a configured secret cross the public API boundary.
            if settings["apiKey"] and settings["apiKey"] in content:
                raise ProviderError("AI 服务响应包含敏感配置，已阻止返回，请检查服务端设置。")
            return {"content": content.strip(), "model": settings["model"]}
        except ProviderError:
            raise
        except httpx.TimeoutException:
            raise ProviderError("AI 服务响应超时，输入已保留，请稍后重试。", 504) from None
        except httpx.HTTPError:
            raise ProviderError("无法连接 AI 服务，请检查 API 地址和网络连接。", 502) from None
        except (ValueError, KeyError, IndexError, TypeError, UnicodeError):
            raise ProviderError("AI 服务返回格式不正确，请检查是否兼容 chat/completions。", 502) from None
