"""Real FalkorDB route tests: arbitrary pins, branches, isolation and unsupported parts."""
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from redis.exceptions import ResponseError

from circuitdoctor.api import app
from circuitdoctor.chat import execute_tool, ask_circuit
from circuitdoctor.parser import parse_netlist
from circuitdoctor.paths import find_path, MAX_HOPS
from circuitdoctor.storage import get_store, ConnectionNotFound, StorageUnavailable
from circuitdoctor.path_model import PATH_MODEL_VERSION, RESISTOR_QUERY


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
        self.assertEqual(self.store.read(cid), before)  # Original exported wiring is unchanged.

    def test_upload_prepares_links_and_all_route_requests_are_read_only(self):
        cid, graph = self.own()
        self.assertEqual(graph.ro_query('MATCH ()-[e:THROUGH]->() RETURN count(e)').result_set, [[2]])
        self.assertEqual(graph.ro_query('MATCH (m:Circuit) RETURN m.path_model_version').result_set,
                         [[PATH_MODEL_VERSION]])
        args = {'from_ref': 'BOARD9', 'from_pin': '007', 'to_ref': 'MODULEΩ', 'to_pin': 'VCC'}
        with patch.object(self.store.db, 'select_graph', return_value=graph), \
             patch.object(graph, 'query', side_effect=AssertionError('route attempted a write')), \
             patch.object(self.store, '_write_batches', side_effect=AssertionError('route attempted a batch')):
            for _ in range(2):
                self.assertEqual(self.client.post(f'/api/circuits/{cid}/path', json=args).json()['status'], 'found')
                result = execute_tool(self.store, cid, 'find_path', args)
                self.assertEqual(result['status'], 'found')
                self.assertEqual(len(result['queries']), 1)
                self.assertIn('shortestPath', result['queries'][0]['cypher'])

    def test_failed_path_preparation_does_not_publish_partial_upload(self):
        cid = uuid4().hex
        class FixedId:
            hex = cid
        original_write = self.store._write_batches
        def fail_links(graph, query, rows):
            if query == RESISTOR_QUERY:
                raise ResponseError('path creation failed')
            return original_write(graph, query, rows)
        with patch('circuitdoctor.storage.uuid4', return_value=FixedId()), \
             patch.object(self.store, '_write_batches', side_effect=fail_links):
            with self.assertRaises(StorageUnavailable):
                self.store.save(parse_netlist(circuit_text()))
        self.assertFalse(self.store.db.connection.exists(self.store.graph_name(cid)))

    def test_legacy_migration_is_idempotent_and_preserves_original_wiring(self):
        cid, graph = self.own()
        before = self.store.read(cid)
        # Simulate a legacy import whose earlier tracer added only one link.
        graph.query("MATCH ()-[e:THROUGH {ref:'Z23'}]->() DELETE e")
        graph.query('MATCH (m:Circuit) REMOVE m.path_model_version')
        with self.assertRaises(StorageUnavailable):
            self.route(cid)  # Never invent a no-route result for unprepared data.
        with patch.object(self.store.db, 'list_graphs', return_value=[graph.name]):
            self.assertEqual(self.store.migrate_path_models(), 1)
            with patch.object(self.store, '_write_batches', side_effect=AssertionError('already prepared')):
                self.assertEqual(self.store.migrate_path_models(), 0)
        self.assertEqual(self.route(cid)['status'], 'found')
        self.assertEqual(graph.ro_query('MATCH ()-[e:THROUGH]->() RETURN count(e)').result_set, [[2]])
        self.assertEqual(self.store.read(cid), before)

    def test_interrupted_migration_keeps_version_unset_and_can_retry(self):
        cid, graph = self.own()
        graph.query('MATCH ()-[e:THROUGH]->() DELETE e')
        graph.query('MATCH (m:Circuit) REMOVE m.path_model_version')
        def partial_write(target, query, rows):
            target.query(query, {'rows': rows[:1]})
            raise ResponseError('interrupted batch')
        with patch.object(self.store.db, 'list_graphs', return_value=[graph.name]):
            with patch.object(self.store, '_write_batches', side_effect=partial_write), self.assertRaises(StorageUnavailable):
                self.store.migrate_path_models()
            self.assertEqual(graph.ro_query('MATCH (m:Circuit) RETURN m.path_model_version').result_set, [[None]])
            with self.assertRaises(StorageUnavailable):
                self.route(cid)
            self.assertEqual(self.store.migrate_path_models(), 1)
        self.assertEqual(self.route(cid)['status'], 'found')
        self.assertEqual(graph.ro_query('MATCH ()-[e:THROUGH]->() RETURN count(e)').result_set, [[2]])

    def test_migration_skips_unrelated_and_incomplete_graphs(self):
        cid, graph = self.own()
        graph.query('MATCH (m:Circuit) REMOVE m.path_model_version SET m.ready=false')
        with patch.object(self.store.db, 'list_graphs', return_value=['other_graph', 'circuitdoctor_demo', graph.name]), \
             patch.object(self.store, '_write_batches', side_effect=AssertionError('must not write')):
            self.assertEqual(self.store.migrate_path_models(), 0)
        graph.query("MATCH (m:Circuit) SET m.ready=true, m.id='another-owner'")
        with patch.object(self.store.db, 'list_graphs', return_value=[graph.name]), \
             patch.object(self.store, '_write_batches', side_effect=AssertionError('must not write')):
            self.assertEqual(self.store.migrate_path_models(), 0)

    def test_legacy_circuit_without_resistors_is_prepared_once(self):
        cid, graph = self.own('(export (components (comp (ref X) (value unknown))) (nets (net (code 1) (name wire) (node (ref X) (pin A)) (node (ref X) (pin B)))))')
        graph.query('MATCH (m:Circuit) REMOVE m.path_model_version')
        with patch.object(self.store.db, 'list_graphs', return_value=[graph.name]):
            self.assertEqual(self.store.migrate_path_models(), 1)
            self.assertEqual(self.store.migrate_path_models(), 0)
        self.assertEqual(self.route(cid, ('X', 'A'), ('X', 'B'))['status'], 'found')

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
        graph = self.store.db.select_graph(self.store.graph_name(cid))
        original_read = graph.ro_query
        def fail_path(query, *args, **kwargs):
            if 'shortestPath' in query:
                raise ResponseError('timeout')
            return original_read(query, *args, **kwargs)
        with patch.object(self.store.db, 'select_graph', return_value=graph), patch.object(graph, 'ro_query', side_effect=fail_path):
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

class PathStartupTests(unittest.TestCase):
    def test_startup_prepares_saved_paths_once(self):
        with patch('circuitdoctor.api.get_store') as get_store:
            with TestClient(app):
                get_store.return_value.migrate_path_models.assert_called_once_with()
            get_store.return_value.migrate_path_models.assert_called_once_with()

    def test_failed_startup_preparation_does_not_disable_other_endpoints(self):
        with patch('circuitdoctor.api.get_store') as get_store:
            get_store.return_value.migrate_path_models.side_effect = StorageUnavailable('offline')
            get_store.return_value.available.return_value = False
            with self.assertLogs('circuitdoctor.api', level='ERROR'), TestClient(app) as client:
                self.assertEqual(client.get('/api/status').status_code, 200)


class LandingQueryTests(unittest.TestCase):
    def test_landing_page_shows_the_real_trace_query(self):
        import re
        from pathlib import Path
        from circuitdoctor.paths import PATH_QUERY
        source = (Path(__file__).resolve().parents[1] / 'frontend/src/landing.ts').read_text()
        block = re.search(r'PATH_QUERY_LINES = \[(.*?)\];', source, re.S).group(1)
        lines = re.findall(r"'([^']*)'", block)
        self.assertEqual('\n'.join(lines), PATH_QUERY)
