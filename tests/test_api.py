"""The browser must receive the same connectivity as the existing parser."""

from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from circuitdoctor.api import app
from circuitdoctor.parser import load_netlist
from circuitdoctor.storage import StorageUnavailable

ROOT = Path(__file__).resolve().parents[1]


class WorkspaceApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_removed_sample_routes_are_not_available(self):
        with patch("circuitdoctor.api.get_store") as store:
            for name in ("clean", "missing-ground", "uno_short"):
                self.assertEqual(self.client.get(f"/api/samples/{name}").status_code, 404)
                self.assertIn(self.client.post(f"/api/samples/{name}").status_code, (404, 405))
                self.assertIn(self.client.post(f"/api/circuits/samples/{name}").status_code, (404, 405))
            store.assert_not_called()

    def test_raw_upload_preserves_connectivity_and_accepts_utf8_bom(self):
        path = ROOT / "tests/fixtures/kicad/nano_normal.net"
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

    def test_status_reports_actual_database_availability_without_claiming_diagnosis(self):
        for connected in (True, False):
            with patch("circuitdoctor.api.get_store") as get_store:
                get_store.return_value.available.return_value = connected
                response = self.client.get("/api/status")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {
                "parser": "ready", "graph_storage": "connected" if connected else "unavailable",
                "review": "connectivity_and_board_rails",
            })

    def test_invalid_circuit_upload_never_reaches_storage(self):
        with patch("circuitdoctor.api.get_store") as store:
            response = self.client.post("/api/circuits", content=b"(export")
        self.assertEqual(response.status_code, 400)
        store.assert_not_called()

    def test_database_failure_is_not_a_parser_only_success(self):
        with patch("circuitdoctor.api.get_store", side_effect=StorageUnavailable("Database offline")):
            status = self.client.get("/api/status")
            response = self.client.post("/api/circuits", content=(ROOT / "tests/fixtures/kicad/uno_normal.net").read_bytes())
        self.assertEqual(status.json()["graph_storage"], "unavailable")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("components", response.json())


if __name__ == "__main__":
    unittest.main()
