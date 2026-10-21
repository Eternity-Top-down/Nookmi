from fastapi import APIRouter
from fastapi.responses import Response

from ..services.feedback_docx import FeedbackWordRequest, MIME_TYPE, attachment_header, build_feedback_docx

router = APIRouter(prefix="/api/exports")


@router.post("/feedback-docx")
def export_feedback_word(body: FeedbackWordRequest):
    # Export the supplied snapshot only. Do not write to the workspace or call AI.
    return Response(build_feedback_docx(body), media_type=MIME_TYPE,
                    headers={"Content-Disposition": attachment_header(body.title)})
