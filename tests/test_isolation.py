"""Real WCC integration: structural groups, evidence and honest boundaries."""
import copy
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from redis.exceptions import ResponseError
from circuitdoctor.api import app
from circuitdoctor.chat import execute_tool
from circuitdoctor.isolation import WCC_QUERY
from circuitdoctor.parser import parse_netlist
from circuitdoctor.storage import get_store


def circuit(board='Arduino_UNO_R3'):
    return parse_netlist(f'''(export (components
      (comp (ref CTRL9) (value controller) (libsource (lib MCU_Module) (part {board})))
      (comp (ref JACK7) (value terminal))
      (comp (ref X9) (value unknown-part))
      (comp (ref Y3) (value another-part)))
      (nets
        (net (code 01) (name MAIN) (node (ref CTRL9) (pin 7)) (node (ref JACK7) (pin A)))
        (net (code 02) (name GND) (node (ref X9) (pin a)) (node (ref Y3) (pin b)))))''')


@unittest.skipUnless(os.environ.get('CIRCUITDOCTOR_TEST_DB') == '1', 'requires local FalkorDB')
class IsolationTests(unittest.TestCase):
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

    def isolated(self, result):
        return [f for f in result['findings'] if f['rule'] == 'isolated_group']

    def test_disconnected_group_and_exact_evidence_for_both_board_types(self):
        for board in ('Arduino_UNO_R3', 'Arduino_Nano_v3.x'):
            r = self.review(self.save(circuit(board)))
            self.assertEqual(r['isolation']['group_count'], 2)
            self.assertEqual(r['summary']['warnings'], 0)
            item, = self.isolated(r)
            self.assertEqual(item['selection'], {'component_refs': ['X9', 'Y3']})
            self.assertEqual(item['severity'], 'info')
            self.assertIn('intentional', item['message'])
            self.assertEqual({n['id'] for n in item['evidence']['nodes']},
                             {'c:X9', 'c:Y3', 'p:["X9","a"]', 'p:["Y3","b"]', 'n:02'})
            self.assertIn(WCC_QUERY, [q['cypher'] for q in r['queries']])
            self.assertEqual(r['isolation']['algorithm'], 'algo.WCC')

    def test_fixed_upload_and_shared_ground_join_groups_without_claiming_current_flow(self):
        data = circuit()
        broken = self.save(data)
        fixed = copy.deepcopy(data)
        fixed['nets'][1]['nodes'].append({'ref': 'JACK7', 'pin': 'B', 'pinfunction': 'GND', 'pintype': 'passive'})
        r = self.review(self.save(fixed))
        self.assertEqual(r['isolation']['group_count'], 1)
        self.assertEqual(self.isolated(r), [])
        self.assertIn('Not a current-flow', r['isolation']['scope'])
        self.assertEqual(len(self.isolated(self.review(broken))), 1)

    def test_no_supported_board_does_not_guess_main_group(self):
        data = circuit('CustomController')
        r = self.review(self.save(data))
        self.assertEqual(r['isolation']['board_refs'], [])
        self.assertEqual(len(self.isolated(r)), 2)
        self.assertTrue(all('No supported Arduino' in f['message'] for f in self.isolated(r)))
        data['nets'][1]['nodes'].append({'ref': 'CTRL9', 'pin': '8', 'pinfunction': 'unknown', 'pintype': 'unknown'})
        self.assertEqual(self.isolated(self.review(self.save(data))), [])

    def test_pinless_component_and_empty_net_metadata_are_handled(self):
        data = circuit()
        data['nets'] = data['nets'][:1]
        data['nets'].append({'code': 'empty', 'name': 'unused', 'nodes': []})
        r = self.review(self.save(data))
        self.assertEqual(r['isolation']['group_count'], 3)
        items = self.isolated(r)
        self.assertEqual(len(items), 2)
        self.assertEqual({n['id'] for f in items for n in f['evidence']['nodes']}, {'c:X9', 'c:Y3'})
        empty = self.review(self.save(parse_netlist('(export (components) (nets))')))
        self.assertEqual(empty['isolation']['group_count'], 0)
        self.assertEqual(empty['status'], 'incomplete')

    def test_multiple_boards_each_anchor_their_own_group(self):
        data = circuit()
        data['components'][2]['libsource'] = {'lib': 'MCU_Module', 'part': 'Arduino_Nano_v3.x'}
        r = self.review(self.save(data))
        self.assertEqual(r['isolation']['board_refs'], ['CTRL9', 'X9'])
        self.assertEqual(r['isolation']['group_count'], 2)
        self.assertEqual(self.isolated(r), [])

    def test_graph_mutation_is_seen_and_other_upload_stays_isolated(self):
        cid, other = self.save(circuit()), self.save(circuit())
        graph = self.store.db.select_graph(self.store.graph_name(cid))
        # Metadata and derived route edges must not silently merge WCC groups.
        graph.query('MATCH (a:Component {ref:"CTRL9"}), (b:Component {ref:"X9"}) CREATE (a)-[:THROUGH]->(b), (a)-[:ANNOTATION]->(b)')
        self.assertEqual(len(self.isolated(self.review(cid))), 1)
        graph.query('MATCH (:Component {ref:"X9"})-[:HAS_PIN]->(p:Pin), (n:Net {code:"01"}) CREATE (p)-[:ON_NET]->(n)')
        r = execute_tool(self.store, cid, 'check_rules', {})
        self.assertEqual(self.isolated(r), [])
        self.assertEqual(len(self.isolated(self.review(other))), 1)

    def test_wcc_failure_does_not_look_like_no_isolated_groups(self):
        cid = self.save(circuit())
        graph_type = type(self.store.db.select_graph(self.store.graph_name(cid)))
        original = graph_type.ro_query
        def fail(graph, query, *args, **kwargs):
            if query == WCC_QUERY:
                raise ResponseError('algorithm unavailable')
            return original(graph, query, *args, **kwargs)
        with patch.object(graph_type, 'ro_query', fail):
            response = self.client.post(f'/api/circuits/{cid}/review')
        self.assertEqual(response.status_code, 503)
        self.assertIn('disconnected groups', response.json()['detail'])
