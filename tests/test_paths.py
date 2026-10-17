"""Real FalkorDB route tests: arbitrary pins, branches, isolation and unsupported parts."""
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from redis.exceptions import ResponseError

from circuitdoctor.api import app
from circuitdoctor.chat import execute_tool, ask_circuit
from circuitdoctor.parser import parse_netlist
from circuitdoctor.paths import find_path, MAX_HOPS
from circuitdoctor.storage import get_store, ConnectionNotFound, StorageUnavailable


def circuit_text(part='R', lib='Device', extra_pin=False):
    return f'''(export (version E)
    (components
      (comp (ref BOARD9) (value Arduino_UNO_R3) (libsource (lib MCU_Module) (part Arduino_UNO_R3)))
      (comp (ref Z17) (value 470) (libsource (lib {lib}) (part {part})))
      (comp (ref Z23) (value 1k) (libsource (lib Device) (part R_Small)))
      (comp (ref "MODULEΩ") (value "Custom <module>")))
    (libparts (libpart (lib MCU_Module) (part Arduino_UNO_R3) (pins
        (pin (num 007) (name D5) (type output)) (pin (num 008) (name D6) (type output))
        (pin (num G) (name GND) (type power_in))))
      (libpart (lib {lib}) (part {part}) (pins
        (pin (num LEFT) (name ~) (type passive)) (pin (num RIGHT) (name ~) (type passive))
        {'(pin (num TAP) (name ~) (type passive))' if extra_pin else ''})))
    (nets
      (net (code 001) (name "drive ' Ω") (node (ref BOARD9) (pin 007)) (node (ref Z17) (pin LEFT)))
      (net (code 002) (name middle) (node (ref Z17) (pin RIGHT)) (node (ref Z23) (pin IN)))
      (net (code 003) (name output) (node (ref Z23) (pin OUT)) (node (ref MODULEΩ) (pin VCC)) (node (ref MODULEΩ) (pin BRANCH)))
      (net (code 004) (name GND) (node (ref MODULEΩ) (pin GND)) (node (ref BOARD9) (pin G)))))'''


@unittest.skipUnless(os.environ.get('CIRCUITDOCTOR_TEST_DB') == '1', 'requires local FalkorDB')
class PathTests(unittest.TestCase):
    def setUp(self):
        self.store = get_store()
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def own(self, raw=None):
        receipt = self.store.save(parse_netlist(raw or circuit_text()))
        graph = self.store.db.select_graph(receipt['graph_name'])
        self.addCleanup(graph.delete)
        return receipt['circuit_id'], graph

    def route(self, cid, start=('BOARD9', '007'), end=('MODULEΩ', 'VCC')):
        return find_path(self.store, cid, from_ref=start[0], from_pin=start[1], to_ref=end[0], to_pin=end[1])

    def test_multihop_route_reverse_and_exact_branch_evidence(self):
        cid, graph = self.own()
        before = self.store.read(cid)
        result = self.route(cid)
        self.assertEqual(result['status'], 'found')
        self.assertEqual(result['hops'], 8)
        self.assertEqual(result['through_components'], ['Z17', 'Z23'])
        self.assertEqual([s['pin'] for s in result['steps'] if s['kind'] == 'pin'], ['007', 'LEFT', 'RIGHT', 'IN', 'OUT', 'VCC'])
        self.assertNotIn('p:["MODULEΩ","BRANCH"]', [n['id'] for n in result['evidence']['nodes']])
        self.assertIn('shortestPath', result['queries'][-1]['cypher'])
        self.assertNotIn('HAS_PIN', result['queries'][-1]['cypher'])
        memberships = [e for e in result['evidence']['edges'] if e['type'] == 'ON_NET']
        self.assertEqual(len(memberships), 6)
        self.assertTrue(all(e['source'].startswith('p:') and e['target'].startswith('n:') for e in memberships))
        reverse = self.route(cid, ('MODULEΩ', 'VCC'), ('BOARD9', '007'))
        self.assertEqual(reverse['evidence']['paths'][0], list(reversed(result['evidence']['paths'][0])))
        self.assertEqual(graph.ro_query('MATCH ()-[e:THROUGH]->() RETURN count(e)').result_set[0][0], 2)
        self.assertEqual(self.store.read(cid), before)  # Original export unchanged; old imports also work.

    def test_no_internal_mcu_display_or_unknown_part_shortcuts(self):
        cid, _ = self.own()
        for start, end in [(('BOARD9', '007'), ('BOARD9', 'G')), (('MODULEΩ', 'VCC'), ('MODULEΩ', 'GND')), (('BOARD9', '008'), ('BOARD9', '007'))]:
            with self.subTest(start=start, end=end):
                r = self.route(cid, start, end)
                self.assertEqual(r['status'], 'not_found')
                self.assertEqual(r['evidence']['edges'], [])
                self.assertIn('does not mean', r['summary'])

    def test_non_resistors_custom_symbols_and_three_pin_resistors_not_crossed(self):
        for part, lib, extra in [('LED', 'Device', False), ('C', 'Device', False), ('D', 'Device', False), ('R', 'Custom', False), ('R', 'Device', True)]:
            with self.subTest(part=part, lib=lib, extra=extra):
                cid, _ = self.own(circuit_text(part, lib, extra))
                self.assertEqual(self.route(cid)['status'], 'not_found')

    def test_same_pin_and_direct_wire(self):
        cid, _ = self.own()
        same = self.route(cid, ('BOARD9', '008'), ('BOARD9', '008'))
        self.assertEqual(same['hops'], 0)
        self.assertEqual(same['status'], 'found')
        self.assertEqual(len(same['steps']), 1)
        self.assertEqual(self.route(cid, ('MODULEΩ', 'VCC'), ('MODULEΩ', 'BRANCH'))['hops'], 2)

    def test_uses_current_graph_relationships_not_parser_data(self):
        cid, graph = self.own()
        self.assertEqual(self.route(cid)['status'], 'found')
        graph.query('MATCH (c:Component {ref:$ref})-[:HAS_PIN]->(p:Pin {number:$pin})-[e:ON_NET]->() DELETE e', {'ref': 'Z23', 'pin': 'OUT'})
        self.assertEqual(self.route(cid)['status'], 'not_found')

    def test_missing_pins_circuit_isolation_validation_and_timeout(self):
        cid, _ = self.own()
        other, _ = self.own('(export (components) (nets))')
        args = {'from_ref': 'BOARD9', 'from_pin': '007', 'to_ref': 'MODULEΩ', 'to_pin': 'VCC'}
        self.assertEqual(self.client.post(f'/api/circuits/{cid}/path', json=args).status_code, 200)
        self.assertEqual(self.client.post(f'/api/circuits/{other}/path', json=args).status_code, 404)
        self.assertEqual(self.client.post('/api/circuits/not-a-graph/path', json=args).status_code, 404)
        for changed in [dict(args, from_pin='D5'), dict(args, to_pin="x' MATCH (n)")]:
            self.assertEqual(self.client.post(f'/api/circuits/{cid}/path', json=changed).status_code, 404)
        for changed in [dict(args, max_hops=999), dict(args, from_pin=''), dict(args, from_pin=7)]:
            self.assertEqual(self.client.post(f'/api/circuits/{cid}/path', json=changed).status_code, 422)
        with patch.object(self.store, '_write_batches', side_effect=ResponseError('timeout')):
            self.assertEqual(self.client.post(f'/api/circuits/{cid}/path', json=args).status_code, 503)
        with self.assertRaises(ValueError):
            execute_tool(self.store, cid, 'find_path', dict(args, circuit_id=other))

    def test_bounded_search_does_not_claim_long_route_is_a_fault(self):
        components = ''.join(f'(comp (ref Z{i}) (value 1k) (libsource (lib Device) (part R)))' for i in range(12))
        nets = ''.join(f'(net (code {i}) (name N{i}) (node (ref Z{i}) (pin B)) (node (ref Z{i+1}) (pin A)))' for i in range(11))
        raw = f'(export (components {components}) (libparts (libpart (lib Device) (part R) (pins (pin (num A) (name ~) (type passive)) (pin (num B) (name ~) (type passive))))) (nets {nets}))'
        cid, _ = self.own(raw)
        r = self.route(cid, ('Z0', 'A'), ('Z11', 'B'))
        self.assertEqual(r['max_hops'], MAX_HOPS)
        self.assertEqual(r['status'], 'not_found')
        self.assertIn('search limit', r['summary'])

    def test_gemini_tool_round_trip_uses_real_path_evidence(self):
        cid, _ = self.own()
        args = {'from_ref': 'BOARD9', 'from_pin': '007', 'to_ref': 'MODULEΩ', 'to_pin': 'VCC'}
        replies = [
            {'candidates': [{'content': {'role': 'model', 'parts': [{'functionCall': {'name': 'find_path', 'args': args}}]}}]},
            {'candidates': [{'content': {'role': 'model', 'parts': [{'text': 'A route goes through Z17 and Z23 [E2].'}]}, 'finishReason': 'STOP'}]},
        ]
        with patch('circuitdoctor.chat.api_key', return_value='test-only-key'), patch('circuitdoctor.chat.generate', side_effect=replies):
            result = ask_circuit(self.store, cid, 'Find the connection route')
        self.assertEqual(result['tool_calls'], 1)
        self.assertEqual(result['evidence'][2]['tool'], 'find_path')
        self.assertEqual(result['evidence'][2]['result']['status'], 'found')
