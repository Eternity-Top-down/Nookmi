from fastapi import APIRouter, HTTPException, Request

from ..schemas import AISettingsUpdate, GenerateRequest
from ..services.feedback import generate_feedback as generate_and_review
from ..services.prompts import test_messages
from ..services.provider import ProviderError
from ..services.settings import SettingsUnavailable

router = APIRouter(prefix="/api/ai")


@router.get("/settings")
def get_settings(request: Request):
    try:
        return request.app.state.settings.read_public()
    except SettingsUnavailable as error:
        raise HTTPException(503, str(error)) from None


@router.put("/settings")
def put_settings(body: AISettingsUpdate, request: Request):
    try:
        return request.app.state.settings.update(body)
    except SettingsUnavailable as error:
        raise HTTPException(503, str(error)) from None


@router.post("/test")
def test_connection(request: Request):
    try:
        request.app.state.provider.complete(test_messages())
        return {"ok": True, "message": "AI 服务连接成功，模型已返回测试响应。"}
    except ProviderError as error:
        raise HTTPException(error.status, error.message) from None


@router.post("/generate")
def generate_feedback(body: GenerateRequest, request: Request):
    try:
        return generate_and_review(body, request.app.state.provider)
    except ProviderError as error:
        raise HTTPException(error.status, error.message) from None
