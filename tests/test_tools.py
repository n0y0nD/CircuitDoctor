"""Connection explanations must be supported by the current stored graph."""

import os
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from redis.exceptions import ResponseError

from circuitdoctor.api import app
from circuitdoctor.parser import parse_netlist
from circuitdoctor.storage import CircuitStore, StorageUnavailable, get_store
from circuitdoctor.tools import explain_net
from test_storage import generic_netlist


class ExplainValidationTests(unittest.TestCase):
    def test_invalid_selectors_never_query_storage(self):
        client = TestClient(app)
        self.addCleanup(client.close)
        for payload in ({}, {"ref": "A1"}, {"pin": "28"}, {"net_code": ""},
                        {"net_code": "1", "net_name": "net"}, {"ref": "A1", "pin": "1", "net_code": "2"},
                        {"net_code": 1}, {"net_name": "net", "extra": "ignored?"}):
            with self.subTest(payload=payload), patch("circuitdoctor.api.get_store") as store:
                response = client.post(f'/api/circuits/{"a" * 32}/explain', json=payload)
                self.assertEqual(response.status_code, 422, response.text)
                store.assert_not_called()
        store = Mock()
        with self.assertRaises(ValueError):
            explain_net(store, "a" * 32, ref="A1")
        store.connection_facts.assert_not_called()

    def test_tool_reports_database_outage_without_fallback(self):
        with TestClient(app) as client, patch("circuitdoctor.api.get_store", side_effect=StorageUnavailable("offline")):
            response = client.post(f'/api/circuits/{"a" * 32}/explain', json={"net_code": "1"})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("summary", response.json())

    def test_query_error_is_translated_to_unavailable(self):
        db = Mock()
        db.connection.exists.return_value = True
        db.select_graph.return_value.ro_query.side_effect = ResponseError("forced failure")
        with self.assertRaises(StorageUnavailable):
            CircuitStore(db).connection_facts("a" * 32, net_code="1")


@unittest.skipUnless(os.environ.get("CIRCUITDOCTOR_TEST_DB") == "1", "requires local FalkorDB")
class ExplainIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.store = get_store()
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def save(self, data):
        receipt = self.store.save(data)
        self.addCleanup(self.store.db.select_graph(receipt["graph_name"]).delete)
        return receipt["circuit_id"]

    def explain(self, cid, selector, status=200):
        result = self.client.post(f"/api/circuits/{cid}/explain", json=selector)
        self.assertEqual(result.status_code, status, result.text)
        return result.json()

    def test_custom_uno_nano_pins_have_exact_graph_evidence_and_unknown_names(self):
        for board in ("Arduino_UNO_R3", "Arduino_Nano_v3.x"):
            with self.subTest(board=board):
                cid = self.save(parse_netlist(generic_netlist(board)))
                result = self.explain(cid, {"ref": "CTRL7", "pin": "01"})
                net = result["nets"][0]
                self.assertEqual((net["code"], net["pin_count"], net["component_count"]), ("007", 3, 2))
                self.assertEqual(net["status"], "connected")
                self.assertIn("CTRL7 pin 01 (D2)", result["summary"])
                self.assertIn("X42 pin IN_A (name unknown)", result["summary"])
                evidence = result["evidence"]
                self.assertEqual(len(evidence["nodes"]), 6)
                self.assertEqual(len(evidence["edges"]), 6)
                self.assertEqual(len(evidence["paths"]), 3)
                self.assertIn(['c:CTRL7', 'p:["CTRL7","01"]', 'n:007'], evidence["paths"])
                self.assertEqual({p["pin"] for p in net["pins"]}, {"01", "02", "IN_A"})
                # Same lookup by exact name; quotes remain parameters, not Cypher source.
                by_name = self.explain(cid, {"net_name": "custom ' shared-net"})
                self.assertEqual(by_name["nets"], result["nets"])
                self.assertTrue(any(q["parameters"] == {"name": "custom ' shared-net"} for q in by_name["queries"]))
                self.assertFalse(any("custom ' shared-net" in q["cypher"] for q in by_name["queries"]))
                self.explain(cid, {"ref": "CTRL7", "pin": "1"}, 404)  # 01 != 1
                self.explain(cid, {"net_name": "x'}) MATCH (n) DELETE n //"}, 404)
                self.assertEqual(len(self.store.read(cid)["nets"][0]["nodes"]), 3)

    def test_library_only_pin_is_not_claimed_to_be_floating_or_broken(self):
        cid = self.save(parse_netlist(generic_netlist("Arduino_UNO_R3")))
        result = self.explain(cid, {"ref": "CTRL7", "pin": "03"})
        self.assertEqual(result["nets"], [])
        self.assertEqual(result["observations"][0]["code"], "no_exported_connection")
        self.assertEqual(len(result["evidence"]["edges"]), 1)
        self.assertEqual(result["evidence"]["edges"][0]["type"], "HAS_PIN")
        self.assertNotIn("floating", result["summary"])
        self.assertNotIn("broken", result["summary"])

    def test_graph_changes_are_reflected_and_never_leak_from_another_upload(self):
        circuit = parse_netlist(generic_netlist("Arduino_UNO_R3"))
        first, second = self.save(circuit), self.save(circuit)
        graph = self.store.db.select_graph(self.store.graph_name(first))
        graph.query("MATCH (p:Pin {number:$pin})-[r:ON_NET]->() DELETE r", {"pin": "IN_A"})
        self.assertEqual(self.explain(first, {"net_code": "007"})["nets"][0]["pin_count"], 2)
        self.assertEqual(self.explain(second, {"net_code": "007"})["nets"][0]["pin_count"], 3)
        no_net = self.explain(first, {"ref": "X42", "pin": "IN_A"})
        self.assertEqual(no_net["nets"], [])

    def test_duplicate_names_require_code_and_singletons_are_observations(self):
        circuit = parse_netlist('''(export (components (comp (ref J9) (value Connector)))
          (nets (net (code 01) (name repeated) (node (ref J9) (pin A)))
                (net (code 02) (name other) (node (ref J9) (pin B) (pintype "passive+no_connect")))
                (net (code 03) (name empty) (node (ref J9) (pin C)))))''')
        cid = self.save(circuit)
        self.store.db.select_graph(self.store.graph_name(cid)).query(
            "MATCH (p:Pin {number:$pin})-[r:ON_NET]->() DELETE r", {"pin": "C"})
        # The parser rejects duplicate names, but external graph edits can introduce them.
        self.store.db.select_graph(self.store.graph_name(cid)).query(
            "MATCH (n:Net {code:$code}) SET n.name=$name", {"code": "02", "name": "repeated"})
        self.explain(cid, {"net_name": "repeated"}, 409)
        self.assertEqual(self.explain(cid, {"net_code": "01"})["nets"][0]["status"], "single_pin_net")
        self.assertEqual(self.explain(cid, {"net_code": "02"})["nets"][0]["status"], "marked_unused")
        self.assertEqual(self.explain(cid, {"net_code": "03"})["nets"][0]["status"], "empty_net")

    def test_unknown_circuit_does_not_create_a_graph(self):
        cid = uuid4().hex
        self.explain(cid, {"net_code": "1"}, 404)
        self.assertFalse(self.store.db.connection.exists(self.store.graph_name(cid)))
        self.explain("not-a-circuit-id", {"net_code": "1"}, 404)


if __name__ == "__main__":
    unittest.main()
