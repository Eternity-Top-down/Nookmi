import sqlite3

from fastapi import APIRouter, HTTPException, Request

from ..database import RevisionConflict
from ..schemas import WorkspaceUpdate

router = APIRouter(prefix="/api")


@router.get("/health")
def health(request: Request):
    return {"ok": True, "service": "nookmi", "storage": "sqlite", "version": request.app.version}


@router.get("/workspace")
def get_workspace(request: Request):
    try:
        return request.app.state.database.read()
    except sqlite3.Error:
        raise HTTPException(503, "本地数据库暂时无法读取，请检查目录权限后重试。") from None


@router.put("/workspace")
def put_workspace(body: WorkspaceUpdate, request: Request):
    try:
        return request.app.state.database.replace(body.data, body.revision)
    except RevisionConflict:
        raise HTTPException(409, "数据已在其他窗口更新。请先备份当前输入，再刷新获取最新数据，避免覆盖。") from None
    except sqlite3.Error:
        raise HTTPException(503, "本地数据库保存失败，原数据已保留，请检查存储空间与目录权限。") from None
