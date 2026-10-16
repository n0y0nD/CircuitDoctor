"""Review observations follow current graph relationships, not sample names."""
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from redis.exceptions import ResponseError
from circuitdoctor.api import app
from circuitdoctor.parser import load_netlist, parse_netlist
from circuitdoctor.storage import CircuitStore, StorageUnavailable, get_store
from test_storage import generic_netlist

ROOT = Path(__file__).resolve().parents[1]


class ReviewFailureTests(unittest.TestCase):
    def test_database_failure_is_not_a_successful_empty_review(self):
        with TestClient(app) as client, patch('circuitdoctor.api.get_store', side_effect=StorageUnavailable('offline')):
            response = client.post(f'/api/circuits/{"a" * 32}/review')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('findings', response.json())

    def test_query_failure_is_translated(self):
        db = Mock()
        db.connection.exists.return_value = True
        db.select_graph.return_value.ro_query.side_effect = ResponseError('test failure')
        with self.assertRaises(StorageUnavailable):
            CircuitStore(db).review_facts('a' * 32)


@unittest.skipUnless(os.environ.get('CIRCUITDOCTOR_TEST_DB') == '1', 'requires local FalkorDB')
class ReviewIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.store = get_store()
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def save(self, data):
        saved = self.store.save(data)
        self.addCleanup(self.store.db.select_graph(saved['graph_name']).delete)
        return saved['circuit_id']

    def review(self, cid):
        response = self.client.post(f'/api/circuits/{cid}/review')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_clean_and_missing_ground_only_flag_unmarked_singleton(self):
        clean = self.review(self.save(load_netlist(ROOT / 'samples/clean.net')))
        faulty = self.review(self.save(load_netlist(ROOT / 'samples/missing_ground.net')))
        self.assertEqual(clean['summary']['warnings'], 0)
        self.assertGreater(clean['summary']['marked_unused_pins'], 20)
        self.assertEqual(faulty['summary']['warnings'], 1)
        finding = next(f for f in faulty['findings'] if f['severity'] == 'warning')
        self.assertEqual(finding['rule'], 'single_pin_net')
        self.assertIn('D1 pin 1', finding['message'])
        self.assertNotIn('GND', finding['suggestion'])  # No guessed destination.
        self.assertIn('p:["D1","1"]', [n['id'] for n in finding['evidence']['nodes']])
        self.assertEqual(len(finding['evidence']['paths'][0]), 3)
        self.assertTrue(clean['cannot_verify'])
        self.assertEqual(clean['scope'], 'connectivity_and_board_rails')

    def test_renamed_circuit_uses_metadata_not_net_names_or_reference_prefixes(self):
        data = parse_netlist('''(export (components (comp (ref CUSTOM) (value module)))
          (nets (net (code 001) (name "unconnected-but-unmarked") (node (ref CUSTOM) (pin 007) (pintype passive)))
                (net (code 002) (name arbitrary) (node (ref CUSTOM) (pin 008) (pintype "input+no_connect")))))''')
        result = self.review(self.save(data))
        self.assertEqual(result['summary']['warnings'], 1)
        self.assertEqual(result['summary']['marked_unused_pins'], 1)
        finding = result['findings'][0]
        self.assertEqual(finding['selection'], {'net_code': '001'})
        self.assertIn('CUSTOM pin 007', finding['message'])
        self.assertGreater(result['summary']['unknown_pin_names'], 0)

    def test_generic_uno_nano_unassigned_pin_is_information_not_a_fault(self):
        for board in ('Arduino_UNO_R3', 'Arduino_Nano_v3.x'):
            with self.subTest(board=board):
                result = self.review(self.save(parse_netlist(generic_netlist(board))))
                self.assertEqual(result['summary']['warnings'], 0)
                self.assertEqual(result['summary']['information'], 1)
                finding = result['findings'][0]
                self.assertEqual(finding['selection'], {'ref': 'CTRL7', 'pin': '03'})
                self.assertEqual(finding['severity'], 'info')
                self.assertEqual(finding['evidence']['paths'], [['c:CTRL7', 'p:["CTRL7","03"]']])
                self.assertEqual(len(result['queries']), 4)  # No query per pin or net.

    def test_mutated_graph_is_reviewed_and_other_upload_is_unchanged(self):
        data = parse_netlist(generic_netlist('Arduino_UNO_R3'))
        first, second = self.save(data), self.save(data)
        graph = self.store.db.select_graph(self.store.graph_name(first))
        graph.query('MATCH (p:Pin)-[e:ON_NET]->() WHERE p.number IN $pins DELETE e', {'pins': ['02', 'IN_A']})
        changed = self.review(first)
        self.assertEqual(changed['summary']['warnings'], 1)
        self.assertEqual(self.review(second)['summary']['warnings'], 0)
        graph.query('MATCH ()-[e:ON_NET]->() DELETE e')
        empty_net = self.review(first)
        self.assertTrue(any(f['rule'] == 'empty_net' for f in empty_net['findings']))
        self.assertEqual(empty_net['summary']['warnings'], 0)

    def test_empty_and_unknown_circuits_do_not_claim_to_pass(self):
        empty = self.review(self.save(parse_netlist('(export (components) (nets))')))
        self.assertEqual(empty['status'], 'incomplete')
        self.assertEqual(empty['summary']['pins'], 0)
        cid = uuid4().hex
        for identifier in (cid, 'invalid-id'):
            response = self.client.post(f'/api/circuits/{identifier}/review')
            self.assertEqual(response.status_code, 404)
        self.assertFalse(self.store.db.connection.exists(self.store.graph_name(cid)))
