"""A power trace must never treat arbitrary connectivity as supply dependency."""
import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from circuitdoctor.api import app
from circuitdoctor.parser import parse_netlist
from circuitdoctor.storage import get_store, StorageUnavailable
from test_parts import rail_circuit


def branching_circuit(part='Arduino_UNO_R3'):
    data = parse_netlist(rail_circuit(part, names=('+5V', 'GND', 'D13')))
    power, ground, signal = data['nets'][0]['nodes']
    data['components'] += [
        {'ref': 'R42', 'value': '330', 'libsource': {'lib': 'Device', 'part': 'R'}},
        {'ref': 'X7', 'value': 'Unknown load', 'libsource': {'lib': 'Custom', 'part': 'Unknown'}},
    ]
    def pin(ref, number):
        return {'ref': ref, 'pin': number, 'pinfunction': 'unknown', 'pintype': 'passive'}
    data['nets'] = [
        {'code': '007', 'name': 'supply', 'nodes': [power, pin('R42', '01')]},
        {'code': '008', 'name': 'after_resistor', 'nodes': [pin('R42', '02'), pin('X7', 'A')]},
        {'code': '009', 'name': 'return', 'nodes': [ground, pin('X7', 'K')]},
        {'code': '010', 'name': '+5V misleading label', 'nodes': [signal]},
    ]
    return data


class PowerApiValidationTests(unittest.TestCase):
    def test_invalid_selectors_and_database_outage(self):
        with patch('circuitdoctor.api.migrate_saved_paths'), TestClient(app) as client, patch('circuitdoctor.api.get_store') as store:
            for selector in ({}, {'ref': 'A'}, {'net_code': '1', 'pin': '2'}, {'net_code': ''}, {'unexpected': '1'}):
                self.assertEqual(client.post('/api/circuits/id/power-trace', json=selector).status_code, 422)
            store.assert_not_called()
            store.side_effect = StorageUnavailable('Database offline')
            response = client.post('/api/circuits/id/power-trace', json={'net_code': '1'})
            self.assertEqual(response.status_code, 503)


@unittest.skipUnless(os.environ.get('CIRCUITDOCTOR_TEST_DB') == '1', 'requires local FalkorDB')
class PowerTraceTests(unittest.TestCase):
    def setUp(self):
        self.store = get_store()
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def save(self, data):
        receipt = self.store.save(data)
        self.addCleanup(self.store.db.select_graph(receipt['graph_name']).delete)
        return receipt['circuit_id']

    def trace(self, cid, selector):
        return self.client.post(f'/api/circuits/{cid}/power-trace', json=selector)

    def test_both_boards_stop_at_resistor_and_preserve_exact_pin_ids(self):
        for part in ('Arduino_UNO_R3', 'Arduino_Nano_v3.x'):
            cid = self.save(branching_circuit(part))
            for selector in ({'ref': 'CTRL9', 'pin': 'P0'}, {'net_code': '007'}):
                response = self.trace(cid, selector)
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()
                self.assertEqual(result['connected_parts'], ['R42'])
                self.assertEqual(result['connected_pins'][0]['pin'], '01')
                self.assertIn(['c:R42', 'p:["R42","01"]', 'n:007'], result['evidence']['paths'])
                self.assertNotIn('c:X7', [node['id'] for node in result['evidence']['nodes']])
                self.assertEqual(result['scope'], 'direct_board_rail')
                self.assertIn('alternative power', ' '.join(result['limitations']))
                self.assertTrue(result['sources'])

    def test_ground_signals_unknown_pins_and_rail_names_are_not_sources(self):
        cid = self.save(branching_circuit())
        for selector in ({'ref': 'CTRL9', 'pin': 'P1'}, {'ref': 'CTRL9', 'pin': 'P2'},
                         {'ref': 'R42', 'pin': '01'}, {'net_code': '009'}, {'net_code': '010'}, {'net_code': '008'}):
            self.assertEqual(self.trace(cid, selector).status_code, 422)
        self.assertEqual(self.trace(cid, {'ref': 'R42', 'pin': '1'}).status_code, 404)

    def test_isolation_and_conflicting_metadata(self):
        cid = self.save(branching_circuit())
        data = branching_circuit()
        data['nets'][0]['nodes'][0]['pinfunction'] = 'D13'
        other = self.save(data)
        self.assertEqual(self.trace(other, {'net_code': '007'}).status_code, 422)
        self.assertEqual(self.trace(cid, {'net_code': '007'}).status_code, 200)
        self.assertEqual(self.trace('0' * 32, {'net_code': '007'}).status_code, 404)

    def test_short_and_conflicting_rails_are_flagged_not_normalized(self):
        cid = self.save(parse_netlist(rail_circuit(names=('+5V', '+3V3', 'GND'))))
        result = self.trace(cid, {'net_code': '007'}).json()
        self.assertEqual(len(result['warnings']), 2)
        self.assertEqual({p['nominal_voltage'] for p in result['rails']}, {5, 3.3})

    def test_library_only_rail_has_no_invented_connections(self):
        data = branching_circuit()
        data['nets'][0]['nodes'] = data['nets'][0]['nodes'][1:]
        cid = self.save(data)
        result = self.trace(cid, {'ref': 'CTRL9', 'pin': 'P0'}).json()
        self.assertEqual(result['connected_parts'], [])
        self.assertEqual(result['evidence']['paths'], [['c:CTRL9', 'p:["CTRL9","P0"]']])
