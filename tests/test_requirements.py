"""Required pins must be source-backed; unknown supply paths are not faults."""
import copy
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from redis.exceptions import ResponseError
from circuitdoctor.api import app
from circuitdoctor.chat import execute_tool
from circuitdoctor.parser import parse_netlist
from circuitdoctor.requirements import REQUIRED_QUERY, required_connections
from circuitdoctor.storage import get_store, StorageUnavailable


def required_circuit(lcd=False, board='Arduino_UNO_R3'):
    lib, part, ground, supply = ('Display_Character', 'LCD-016N002L', 'VSS', 'VDD') if lcd else ('Display_Graphic', 'ER_OLEDM0.91_1x-I2C', 'GND', 'VCC')
    return parse_netlist(f'''(export (components
      (comp (ref CTRL42) (value controller) (libsource (lib MCU_Module) (part {board})))
      (comp (ref PANEL9) (value "my own display") (libsource (lib {lib}) (part {part}))))
      (libparts
        (libpart (lib MCU_Module) (part {board}) (pins
          (pin (num RETURN) (name GND) (type power_in))
          (pin (num SUPPLY) (name +3V3) (type power_out))))
        (libpart (lib {lib}) (part {part}) (pins
          (pin (num 1) (name {ground}) (type power_in))
          (pin (num 2) (name {supply}) (type power_in)))))
      (nets
        (net (code 007) (name "arbitrary Ω") (node (ref CTRL42) (pin RETURN)) (node (ref PANEL9) (pin 1)))
        (net (code 008) (name another) (node (ref CTRL42) (pin SUPPLY)) (node (ref PANEL9) (pin 2)))))''')


@unittest.skipUnless(os.environ.get('CIRCUITDOCTOR_TEST_DB') == '1', 'requires local FalkorDB')
class RequiredPinTests(unittest.TestCase):
    def setUp(self):
        self.store = get_store()
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def save(self, data):
        r = self.store.save(data)
        self.addCleanup(self.store.db.select_graph(r['graph_name']).delete)
        return r['circuit_id']

    def review(self, cid):
        r = self.client.post(f'/api/circuits/{cid}/review')
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_complete_designs_have_source_backed_connections_with_arbitrary_refs(self):
        for lcd in (False, True):
            for board in ('Arduino_UNO_R3', 'Arduino_Nano_v3.x'):
                with self.subTest(lcd=lcd, board=board):
                    cid = self.save(required_circuit(lcd, board))
                    r = self.review(cid)
                    self.assertEqual(r['summary']['warnings'], 0)
                    self.assertEqual(r['requirements']['connected_pins'], 2)
                    self.assertEqual(r['requirements']['checked_pins'], 2)
                    self.assertEqual(r['queries'][-1]['cypher'], REQUIRED_QUERY)
                    self.assertNotIn('HAS_PIN', r['queries'][-1]['cypher'])
                    self.assertTrue(r['requirements']['recognized_parts'][0]['sources'])
                    ground = next(p for p in r['requirements']['pins'] if p['pin'] == '1')
                    self.assertEqual(ground['anchors'], [['CTRL42', 'RETURN']])

    def test_missing_ground_and_supply_warn_then_corrected_upload_removes_warning(self):
        for number, role in [('1', 'ground'), ('2', 'power')]:
            clean = required_circuit()
            broken = copy.deepcopy(clean)
            for net in broken['nets']:
                net['nodes'] = [p for p in net['nodes'] if not (p['ref'] == 'PANEL9' and p['pin'] == number)]
            r = self.review(self.save(broken))
            warnings = [f for f in r['findings'] if f['severity'] == 'warning']
            self.assertEqual(len(warnings), 1)
            self.assertEqual(warnings[0]['rule'], f'required_{role}_unconnected')
            self.assertEqual(warnings[0]['selection'], {'ref': 'PANEL9', 'pin': number})
            self.assertIn(f'p:["PANEL9","{number}"]', [n['id'] for n in warnings[0]['evidence']['nodes']])
            self.assertIn('possible reason', warnings[0]['message'])
            self.assertFalse(any(f['rule'] == 'unassigned_pin' and f['selection'] == warnings[0]['selection'] for f in r['findings']))
            self.assertEqual(self.review(self.save(clean))['summary']['warnings'], 0)

    def test_singleton_required_pin_warns_even_if_marked_unused(self):
        data = required_circuit()
        data['nets'][0]['nodes'] = [data['nets'][0]['nodes'][1]]
        data['nets'][0]['nodes'][0]['pintype'] = 'power_in+no_connect'
        r = self.review(self.save(data))
        finding = next(f for f in r['findings'] if f['rule'] == 'required_ground_unconnected')
        self.assertEqual(finding['severity'], 'warning')
        self.assertIn('n:007', [n['id'] for n in finding['evidence']['nodes']])

    def test_external_supplies_unknown_parts_and_net_names_do_not_create_false_verdicts(self):
        data = required_circuit()
        data['components'][0]['libsource'] = {'lib': 'Custom', 'part': 'external_supply'}
        data['nets'][0]['name'] = 'GND'
        data['nets'][1]['name'] = '+3V3'
        r = self.review(self.save(data))
        self.assertEqual(r['summary']['warnings'], 0)
        self.assertEqual(r['requirements']['connected_pins'], 0)
        self.assertEqual(len(r['requirements']['unverified_pins']), 2)
        for lib, part in [('Custom', 'ER_OLEDM0.91_1x-I2C'), ('Display_Graphic', 'unknown_OLED')]:
            data = required_circuit()
            data['components'][1]['libsource'] = {'lib': lib, 'part': part}
            data['components'][1]['value'] = 'ER_OLEDM0.91_1x-I2C'
            data['nets'][0]['nodes'] = [data['nets'][0]['nodes'][1]]
            r = self.review(self.save(data))
            self.assertEqual(r['requirements']['checked_pins'], 0)
            self.assertEqual(r['summary']['warnings'], 0)

    def test_missing_or_conflicting_pin_metadata_is_skipped_not_guessed(self):
        for mode in ('conflict', 'no_names', 'absent', 'renumbered'):
            data = required_circuit()
            if mode == 'conflict':
                data['nets'][0]['nodes'][1]['pinfunction'] = 'VCC'
            elif mode == 'no_names':
                data['libparts'][1]['pins'][0]['name'] = 'unknown'
            elif mode == 'absent':
                data['libparts'][1]['pins'].pop(0)
                data['nets'][0]['nodes'].pop(1)
            else:
                data['libparts'][1]['pins'][0]['num'] = '007'
                data['nets'][0]['nodes'][1]['pin'] = '007'
            r = self.review(self.save(data))
            self.assertEqual(r['requirements']['checked_pins'], 1, mode)
            self.assertEqual(r['requirements']['skipped_pins'][0]['pin'], '1')
            self.assertEqual(r['summary']['warnings'], 0)

    def test_graph_mutation_and_chat_use_current_connections_without_cross_circuit_leaks(self):
        first, second = self.save(required_circuit()), self.save(required_circuit())
        graph = self.store.db.select_graph(self.store.graph_name(first))
        graph.query('MATCH (:Component {ref:$ref})-[:HAS_PIN]->(p:Pin {number:$pin})-[e:ON_NET]->() DELETE e', {'ref': 'PANEL9', 'pin': '1'})
        result = execute_tool(self.store, first, 'check_rules', {})
        self.assertEqual(result['requirements']['missing_pins'], 1)
        self.assertEqual(self.review(second)['requirements']['missing_pins'], 0)

    def test_database_timeout_is_not_reported_as_missing_ground(self):
        cid = self.save(required_circuit())
        facts = self.store.review_facts(cid)
        graph = self.store.db.select_graph(self.store.graph_name(cid))
        with patch.object(self.store.db, 'select_graph', return_value=graph), patch.object(graph, 'ro_query', side_effect=ResponseError('timeout')):
            with self.assertRaises(StorageUnavailable):
                required_connections(self.store, cid, facts)

    def test_ground_connection_through_unknown_part_is_unverified(self):
        data = required_circuit()
        data['components'].append({'ref': 'LINK8', 'value': 'mystery', 'libsource': {'lib': 'Custom', 'part': 'Link'}})
        board_pin, device_pin = data['nets'][0]['nodes']
        def link(pin):
            return {'ref': 'LINK8', 'pin': pin, 'pinfunction': 'unknown', 'pintype': 'passive'}
        data['nets'][0]['nodes'] = [board_pin, link('LEFT')]
        data['nets'].append({'code': '009', 'name': 'GND', 'nodes': [device_pin, link('RIGHT')]})
        r = self.review(self.save(data))
        self.assertEqual(r['summary']['warnings'], 0)
        self.assertEqual(r['requirements']['unverified_pins'][0]['pin'], '1')
