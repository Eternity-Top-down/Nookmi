"""Local API settings. Secrets never enter API responses or logs."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from threading import RLock
from urllib.parse import urlsplit

from ..schemas import AISettingsUpdate


class SettingsUnavailable(Exception):
    pass


class SettingsStore:
    def __init__(self, directory: Path):
        self.path = directory / "ai-settings.json"
        self.lock = RLock()

    def read_private(self) -> dict:
        with self.lock:
            if not self.path.exists():
                return {"baseUrl": "https://api.openai.com/v1", "model": "", "apiKey": ""}
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                checked = AISettingsUpdate.model_validate(raw)
                return {"baseUrl": checked.baseUrl, "model": checked.model, "apiKey": checked.apiKey or ""}
            except (OSError, ValueError, TypeError):
                raise SettingsUnavailable("AI 设置无法读取，请检查本地设置文件或重新配置。") from None

    @staticmethod
    def public(settings: dict) -> dict:
        has_key = bool(settings["apiKey"])
        local_provider = urlsplit(settings["baseUrl"]).hostname in ("localhost", "127.0.0.1", "::1")
        return {
            "baseUrl": settings["baseUrl"], "model": settings["model"],
            "hasApiKey": has_key,
            "configured": bool((has_key or local_provider) and settings["baseUrl"] and settings["model"]),
        }

    def read_public(self) -> dict:
        return self.public(self.read_private())

    def update(self, update: AISettingsUpdate) -> dict:
        with self.lock:
            settings = self.read_private()
            settings["baseUrl"] = update.baseUrl
            settings["model"] = update.model
            if update.clearApiKey:
                settings["apiKey"] = ""
            elif update.apiKey:
                settings["apiKey"] = update.apiKey
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary: str | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w", encoding="utf-8", dir=self.path.parent,
                    prefix=".ai-settings-", suffix=".tmp", delete=False,
                ) as file:
                    temporary = file.name
                    json.dump(settings, file, ensure_ascii=False)
                    file.flush()
                    os.fsync(file.fileno())
                try:
                    os.chmod(temporary, 0o600)
                except OSError:
                    pass
                os.replace(temporary, self.path)
                temporary = None
            except OSError:
                raise SettingsUnavailable("AI 设置保存失败，请检查本地目录写入权限。") from None
            finally:
                if temporary:
                    try:
                        Path(temporary).unlink(missing_ok=True)
                    except OSError:
                        pass
            return self.public(settings)
