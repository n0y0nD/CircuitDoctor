"""The browser must receive the same connectivity as the existing parser."""

from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from circuitdoctor.api import app
from circuitdoctor.parser import load_netlist

ROOT = Path(__file__).resolve().parents[1]


class WorkspaceApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_both_samples_match_direct_parser_output(self):
        for name, filename in (("clean", "clean.net"),
                               ("missing-ground", "missing_ground.net")):
            with self.subTest(sample=name):
                response = self.client.get(f"/api/samples/{name}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), load_netlist(ROOT / "samples" / filename))

    def test_raw_upload_preserves_connectivity_and_accepts_utf8_bom(self):
        path = ROOT / "samples/missing_ground.net"
        response = self.client.post("/api/parse", content=b"\xef\xbb\xbf" + path.read_bytes(),
                                    headers={"Content-Type": "application/octet-stream"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), load_netlist(path))

    def test_invalid_uploads_return_readable_errors_without_partial_data(self):
        for content in (b"", b"(export", b"\xff\xfe", b"<export/>"):
            with self.subTest(content=content):
                response = self.client.post("/api/parse", content=content)
                self.assertEqual(response.status_code, 400)
                self.assertIsInstance(response.json()["detail"], str)
                self.assertNotIn("components", response.json())

    def test_actual_upload_size_is_checked_even_without_content_length(self):
        with patch("circuitdoctor.api.MAX_FILE_BYTES", 32):
            response = self.client.post("/api/parse", content=iter([b"(" * 20, b")" * 20]))
        self.assertEqual(response.status_code, 413)

    def test_only_known_examples_are_served(self):
        response = self.client.get("/api/samples/README.md")
        self.assertEqual(response.status_code, 404)

    def test_status_does_not_claim_database_or_diagnosis_is_ready(self):
        response = self.client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "parser": "ready", "graph_storage": "not_connected", "review": "not_implemented",
        })


if __name__ == "__main__":
    unittest.main()
