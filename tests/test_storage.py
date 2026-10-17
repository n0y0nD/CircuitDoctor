"""Opt-in integration tests against real FalkorDB; only own UUID graphs are deleted.

Run with CIRCUITDOCTOR_TEST_DB=1 python -m unittest discover -s tests -v.
"""

import os
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from redis.exceptions import ResponseError

from circuitdoctor.api import app
from circuitdoctor.parser import load_netlist, parse_netlist
from circuitdoctor.storage import CircuitNotFound, CircuitStore, StorageUnavailable, get_store

ROOT = Path(__file__).resolve().parents[1]


def generic_netlist(board):
    # Arbitrary references, nonnumeric/leading-zero pins, a shared net with two
    # board pins, library-only pins and an unknown component with quoted text.
    return f'''(export (version E)
      (components
        (comp (ref CTRL7) (value "{board}") (libsource (lib MCU_Module) (part "{board}")))
        (comp (ref X42) (value "unknown ' module Ω") (fields (field (name Maker) "custom"))))
      (libparts (libpart (lib MCU_Module) (part "{board}") (pins
        (pin (num 01) (name D2) (type bidirectional))
        (pin (num 02) (name D3) (type bidirectional))
        (pin (num 03) (name A0) (type input)))))
      (nets (net (code 007) (name "custom ' shared-net")
        (node (ref CTRL7) (pin 01)) (node (ref CTRL7) (pin 02))
        (node (ref X42) (pin IN_A)))))'''


class StorageValidationTests(unittest.TestCase):
    def test_graph_id_cannot_address_other_graphs(self):
        for invalid in ("main", "../../graph", "a" * 31, "A" * 32, "x' MATCH (n)"):
            with self.subTest(invalid=invalid), self.assertRaises(CircuitNotFound):
                CircuitStore.graph_name(invalid)


@unittest.skipUnless(os.environ.get("CIRCUITDOCTOR_TEST_DB") == "1", "requires local FalkorDB")
class FalkorDBIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.store = get_store()
        self.assertTrue(self.store.available())
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def own(self, receipt):
        self.addCleanup(self.store.db.select_graph(receipt["graph_name"]).delete)
        return receipt["circuit_id"]

    def test_existing_exports_round_trip_without_losing_metadata(self):
        for filename in ("uno_normal.net", "nano_normal.net"):
            with self.subTest(filename=filename):
                original = load_netlist(ROOT / "tests/fixtures/kicad" / filename)
                cid = self.own(self.store.save(original, filename=filename))
                restored = self.store.read(cid)
                storage = restored.pop("storage")
                self.assertEqual(restored, original)
                self.assertEqual(storage["connections"], sum(len(n["nodes"]) for n in original["nets"]))
                self.assertNotIn("sample", storage)

    def test_generic_uno_and_nano_uploads_are_isolated_and_persistent(self):
        ids = []
        for board in ("Arduino_UNO_R3", "Arduino_Nano_v3.x"):
            raw = generic_netlist(board)
            response = self.client.post("/api/circuits?filename=my-circuit.net", content=raw.encode())
            self.assertEqual(response.status_code, 201, response.text)
            self.assertNotIn("components", response.json())  # Receipt, not parser echo.
            cid = self.own(response.json())
            ids.append(cid)
            restored = CircuitStore(self.store.db).read(cid)  # No in-memory circuit needed.
            meta = restored.pop("storage")
            self.assertEqual(restored, parse_netlist(raw))
            self.assertEqual(meta["pins"], 4)  # Includes unconnected library pin 03.
            self.assertEqual(meta["connections"], 3)
            self.assertEqual(meta["filename"], "my-circuit.net")
        self.assertNotEqual(ids[0], ids[1])
        for cid, board in zip(ids, ("Arduino_UNO_R3", "Arduino_Nano_v3.x")):
            response = self.client.get(f"/api/circuits/{cid}")
            self.assertEqual(response.json()["components"][0]["value"], board)

    def test_read_uses_database_relationships_not_a_saved_parser_blob(self):
        cid = self.own(self.store.save(parse_netlist(generic_netlist("Arduino_UNO_R3"))))
        graph = self.store.db.select_graph(self.store.graph_name(cid))
        graph.query("MATCH (p:Pin {number:$number})-[e:ON_NET]->() DELETE e", {"number": "IN_A"})
        restored = self.client.get(f"/api/circuits/{cid}").json()
        self.assertEqual(len(restored["nets"][0]["nodes"]), 2)
        self.assertEqual(restored["storage"]["connections"], 2)

    def test_repeated_upload_gets_new_graph_and_empty_netlist_is_supported(self):
        data = parse_netlist("(export (components) (nets))")
        first = self.own(self.store.save(data))
        second = self.own(self.store.save(data))
        self.assertNotEqual(first, second)
        restored = self.store.read(first)
        restored.pop("storage")
        self.assertEqual(restored, data)

    def test_failed_import_is_cleaned_and_not_readable(self):
        cid = uuid4().hex
        class FixedId:
            hex = cid
        with patch("circuitdoctor.storage.uuid4", return_value=FixedId()), \
             patch.object(self.store, "_write_batches", side_effect=ResponseError("forced test failure")):
            with self.assertRaises(StorageUnavailable):
                self.store.save(parse_netlist(generic_netlist("Arduino_UNO_R3")))
        self.assertFalse(self.store.db.connection.exists(self.store.graph_name(cid)))

    def test_legacy_saved_circuit_remains_readable(self):
        data = parse_netlist(generic_netlist("Arduino_UNO_R3"))
        cid = self.own(self.store.save(data))
        self.store.db.select_graph(self.store.graph_name(cid)).query(
            "MATCH (m:Circuit) SET m.sample='legacy'")
        restored = self.store.read(cid)
        metadata = restored.pop("storage")
        self.assertNotIn("sample", metadata)
        self.assertEqual(restored, data)

    def test_unknown_ids_do_not_create_graphs(self):
        cid = uuid4().hex
        response = self.client.get(f"/api/circuits/{cid}")
        self.assertEqual(response.status_code, 404)
        self.assertFalse(self.store.db.connection.exists(self.store.graph_name(cid)))



if __name__ == "__main__":
    unittest.main()
