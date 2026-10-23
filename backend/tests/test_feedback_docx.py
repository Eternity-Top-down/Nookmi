from io import BytesIO
from copy import deepcopy
import unittest
from urllib.parse import unquote
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from pydantic import ValidationError

from backend.app.services.feedback_docx import FeedbackWordRequest, W, attachment_header, build_feedback_docx
from backend.tests.test_api import ApiTestCase, workspace

NS = {"w": W}


def sample():
    return {"title": "初二班 2026年10月第4周 晚辅反馈", "entries": [
        {"studentName": "示例学生甲", "content": "本周按时完成作业。\n数学：能独立订正。\n\n建议复习本周错题。"},
        {"studentName": "示例学生乙", "content": "课堂思考认真，建议注意过程书写。"},
    ]}


class FeedbackWordTests(ApiTestCase):
    def test_export_is_editable_word_with_exact_typeface_size_bold_and_content(self):
        response = self.client.post("/api/exports/feedback-docx", json=sample())
        self.assertEqual(response.status_code, 200, response.text[:100])
        self.assertIn("wordprocessingml.document", response.headers["content-type"])
        self.assertEqual(response.headers["cache-control"], "no-store")
        with ZipFile(BytesIO(response.content)) as archive:
            document = ET.fromstring(archive.read("word/document.xml"))
            self.assertIn("word/styles.xml", archive.namelist())
            self.assertFalse(any("media/" in name for name in archive.namelist()))
        paragraphs = document.findall("w:body/w:p", NS)
        self.assertEqual(len(paragraphs), 3)
        self.assertEqual(paragraphs[0].find("w:pPr/w:pStyle", NS).get(f"{{{W}}}val"), "Title")
        self.assertEqual(paragraphs[0].find("w:pPr/w:jc", NS).get(f"{{{W}}}val"), "center")
        self.assertEqual("".join(paragraphs[0].itertext()), sample()["title"])
        self.assertEqual(len(paragraphs[1].findall("w:r/w:br", NS)), 3)
        for paragraph, entry in zip(paragraphs[1:], sample()["entries"]):
            runs = paragraph.findall("w:r", NS)
            self.assertEqual("".join(runs[0].itertext()), entry["studentName"])
            self.assertEqual(runs[0].find("w:rPr/w:b", NS).get(f"{{{W}}}val"), "1")
            self.assertEqual(runs[1].find("w:rPr/w:b", NS).get(f"{{{W}}}val"), "0")
            self.assertEqual("".join(runs[1].itertext()), "：" + entry["content"].replace("\n", ""))
        for run in document.findall(".//w:r", NS):
            self.assertEqual(run.find("w:rPr/w:sz", NS).get(f"{{{W}}}val"), "24")
            fonts = run.find("w:rPr/w:rFonts", NS)
            for attribute in ("ascii", "hAnsi", "eastAsia", "cs"):
                self.assertEqual(fonts.get(f"{{{W}}}{attribute}"), "宋体")
        size = document.find("w:body/w:sectPr/w:pgSz", NS)
        self.assertEqual(size.attrib, {f"{{{W}}}w": "11906", f"{{{W}}}h": "16838"})

    def test_export_does_not_save_or_call_ai_and_keeps_local_access_protection(self):
        data = workspace()
        self.assertEqual(self.put_workspace(data).status_code, 200)
        before = self.client.get("/api/workspace").json()
        self.app.state.provider = object()  # Any AI call would fail this test.
        self.assertEqual(self.client.post("/api/exports/feedback-docx", json=sample()).status_code, 200)
        self.assertEqual(self.client.get("/api/workspace").json(), before)
        response = self.client.post("/api/exports/feedback-docx", json=sample(), headers={"Origin": "https://remote.example"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.post("/api/exports/feedback-docx", content="{}", headers={"Content-Length": "20000001"}).status_code, 413)

    def test_export_validates_blank_and_oversized_input_with_specific_messages(self):
        cases = [
            ({**sample(), "title": " "}, "文档标题"),
            ({**sample(), "title": "字" * 201}, "200"),
            ({**sample(), "entries": []}, "1—500"),
            ({**sample(), "entries": sample()["entries"] * 251}, "1—500"),
            ({**sample(), "entries": [{"studentName": "字" * 81, "content": "正文"}]}, "学生姓名"),
            ({**sample(), "entries": [{"studentName": "甲", "content": ""}]}, "反馈正文"),
            ({**sample(), "entries": [{"studentName": "甲", "content": "字" * 10001}]}, "10000"),
            ({**sample(), "entries": [{"studentName": "甲", "content": "坏\x00字符"}]}, "字符"),
        ]
        for payload, message in cases:
            with self.subTest(message=message):
                response = self.client.post("/api/exports/feedback-docx", json=payload)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn(message, response.json()["detail"])

    def test_title_name_body_and_roster_boundaries_are_accepted(self):
        payload = {"title": "题" * 200, "entries": [{"studentName": "名" * 80, "content": "字" * 10000}]}
        self.assertEqual(self.client.post("/api/exports/feedback-docx", json=payload).status_code, 200)
        payload["entries"] = [{"studentName": f"示例学生{index}", "content": "反馈正文"} for index in range(500)]
        self.assertEqual(self.client.post("/api/exports/feedback-docx", json=payload).status_code, 200)

    def test_total_content_has_a_limit_before_document_creation(self):
        payload = {"title": "汇总反馈", "entries": [{"studentName": "示例学生", "content": "字" * 10000}] * 50}
        FeedbackWordRequest.model_validate(payload)
        payload["entries"].append(payload["entries"][0])
        response = self.client.post("/api/exports/feedback-docx", json=payload)
        self.assertEqual(response.status_code, 422)
        self.assertIn("50 万字", response.json()["detail"])

    def test_xml_and_attachment_filename_escape_input_without_changing_content(self):
        payload = sample()
        payload["title"] = '班级/反馈 "记录"\r\n'
        payload["entries"][0]["content"] = 'a < b & c > d\t原句\r\n下一行'
        original = deepcopy(payload)
        binary = build_feedback_docx(FeedbackWordRequest.model_validate(payload))
        with ZipFile(BytesIO(binary)) as archive:
            document = ET.fromstring(archive.read("word/document.xml"))
        self.assertIn("a < b & c > d", "".join(document.itertext()))
        header = attachment_header(payload["title"])
        self.assertNotIn("\r", header)
        self.assertNotIn("\n", header)
        filename = unquote(header.split("UTF-8''")[1])
        self.assertTrue(filename.endswith(".docx"))
        self.assertNotIn("/", filename)
        self.assertNotIn('"', filename)
        self.assertIn("反馈_CON.docx", unquote(attachment_header("CON")))
        self.assertEqual(payload, original)


if __name__ == "__main__":
    unittest.main()
