"""I2C checks use stored wiring, exact symbols and source-backed pin identities."""
import copy
import os
import unittest
from unittest.mock import patch
from redis.exceptions import ResponseError
from circuitdoctor.i2c import I2C_QUERY, i2c_review
from circuitdoctor.chat import execute_tool
from circuitdoctor.review import check_rules
from circuitdoctor.storage import get_store, StorageUnavailable, _json
from test_requirements import required_circuit


def signal_circuit(board='Arduino_UNO_R3', alternate=False):
    data = required_circuit(board=board)
    numbers = ('23', '24') if board == 'Arduino_Nano_v3.x' else ('31', '32') if alternate else ('13', '14')
    for index, (signal, number, target) in enumerate(zip(('SDA', 'SCL'), numbers, ('4', '3'))):
        data['libparts'][0]['pins'].append({'num': number, 'name': 'A4' if signal == 'SDA' else 'A5', 'type': 'bidirectional'})
        data['libparts'][1]['pins'].append({'num': target, 'name': signal, 'type': 'bidirectional'})
        data['nets'].append({'code': str(100 + index), 'name': 'arbitrary-wire-' + str(index), 'nodes': [
            {'ref': 'CTRL42', 'pin': number, 'pinfunction': 'unknown', 'pintype': 'bidirectional'},
            {'ref': 'PANEL9', 'pin': target, 'pinfunction': signal, 'pintype': 'bidirectional'}]})
    return data


@unittest.skipUnless(os.environ.get('CIRCUITDOCTOR_TEST_DB') == '1', 'requires local FalkorDB')
class I2CTests(unittest.TestCase):
    def setUp(self):
        self.store = get_store()

    def save(self, data):
        result = self.store.save(data)
        self.addCleanup(self.store.db.select_graph(result['graph_name']).delete)
        return result['circuit_id']

    def review(self, data):
        return check_rules(self.store, self.save(data))

    def test_correct_board_pins_and_alternate_headers(self):
        for board, alt in [('Arduino_UNO_R3', False), ('Arduino_UNO_R3', True), ('Arduino_Nano_v3.x', False)]:
            with self.subTest(board=board, alt=alt):
                r = self.review(signal_circuit(board, alt))
                self.assertEqual([p['status'] for p in r['i2c']['checks']], ['connected', 'connected'])
                self.assertEqual(r['summary']['warnings'], 0)
                self.assertIn(I2C_QUERY, [q['cypher'] for q in r['queries']])
                self.assertTrue(all(p['sources'] and p['evidence']['edges'] for p in r['i2c']['checks']))

    def test_swapped_signals_and_corrected_upload(self):
        data = signal_circuit()
        data['nets'][2]['nodes'][0], data['nets'][3]['nodes'][0] = data['nets'][3]['nodes'][0], data['nets'][2]['nodes'][0]
        r = self.review(data)
        findings = [f for f in r['findings'] if f['rule'] == 'i2c_signal_mismatch']
        self.assertEqual(len(findings), 2)
        sda = next(f for f in findings if f['selection']['pin'] == '4')
        self.assertEqual(sda['selection'], {'ref': 'PANEL9', 'pin': '4'})
        self.assertIn('CTRL42 pin 14 (SCL)', sda['message'])
        self.assertIn('software I2C', sda['suggestion'])
        ids = {n['id'] for n in sda['evidence']['nodes']}
        self.assertTrue({'p:["PANEL9","4"]', 'p:["CTRL42","14"]', 'n:100'} <= ids)
        self.assertNotIn('n:101', ids)
        self.assertEqual(self.review(signal_circuit())['summary']['warnings'], 0)

    def test_required_signal_disconnected_and_marked_unused(self):
        for singleton in (False, True):
            data = signal_circuit()
            if singleton:
                data['nets'][2]['nodes'].pop(0)
                data['nets'][2]['nodes'][0]['pintype'] = 'bidirectional+no_connect'
            else:
                data['nets'][2]['nodes'].pop()
            r = self.review(data)
            findings = [f for f in r['findings'] if f['rule'] == 'i2c_signal_unconnected']
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0]['selection'], {'ref': 'PANEL9', 'pin': '4'})
            self.assertIn('p:["PANEL9","4"]', [n['id'] for n in findings[0]['evidence']['nodes']])
            self.assertFalse(any(f['rule'] in ('single_pin_net', 'unassigned_pin') and f['selection'] == findings[0]['selection'] for f in r['findings']))

    def test_joined_lines_are_not_reported_as_correct_even_with_matching_anchors(self):
        data = signal_circuit()
        data['nets'][2]['nodes'] += data['nets'].pop()['nodes']
        r = self.review(data)
        self.assertEqual([p['status'] for p in r['i2c']['checks']], ['joined', 'joined'])
        self.assertEqual(sum(f['rule'] == 'i2c_lines_joined' for f in r['findings']), 1)

    def test_unknown_or_parallel_display_is_not_assumed_i2c(self):
        for lib, part in [('Custom', 'ER_OLEDM0.91_1x-I2C'), ('Display_Character', 'LCD-016N002L')]:
            data = signal_circuit()
            data['components'][1]['libsource'] = {'lib': lib, 'part': part}
            data['components'][1]['value'] = 'I2C OLED SDA SCL'
            r = self.review(data)
            self.assertEqual(r['i2c']['checks'], [])
            self.assertFalse(any(f['rule'].startswith('i2c_') and f['severity'] == 'warning' for f in r['findings']))

    def test_missing_and_conflicting_device_metadata_or_renumbered_pin_are_unverified(self):
        for mode in ('conflict', 'absent', 'unknown', 'renumbered'):
            data = signal_circuit()
            if mode == 'conflict':
                data['nets'][2]['nodes'][1]['pinfunction'] = 'SCL'
            elif mode == 'absent':
                data['libparts'][1]['pins'].pop(2)
                data['nets'][2]['nodes'].pop()
            elif mode == 'unknown':
                data['libparts'][1]['pins'][2]['name'] = 'unknown'
                data['nets'][2]['nodes'][1]['pinfunction'] = 'unknown'
            else:
                data['libparts'][1]['pins'][2]['num'] = '44'
                data['nets'][2]['nodes'][1]['pin'] = '44'
            r = self.review(data)
            self.assertEqual(next(p for p in r['i2c']['checks'] if p['signal'] == 'SDA')['status'], 'unverified', mode)
            self.assertFalse(any(f['rule'].startswith('i2c_') and f['severity'] == 'warning' for f in r['findings']))

    def test_software_i2c_unknown_board_conflicting_metadata_and_intermediate_parts_not_faults(self):
        for mode in ('software', 'unknown_board', 'conflict', 'renumbered', 'resistor'):
            data = signal_circuit()
            if mode == 'software':
                data['libparts'][0]['pins'][2]['name'] = 'D2'
            elif mode == 'unknown_board':
                data['components'][0]['libsource'] = {'lib': 'Custom', 'part': 'Arduino_UNO_R3'}
            elif mode == 'conflict':
                data['nets'][2]['nodes'][0]['pinfunction'] = 'SCL'
            elif mode == 'renumbered':
                data['libparts'][0]['pins'][2]['num'] = '999'
                data['nets'][2]['nodes'][0]['pin'] = '999'
            else:
                data['components'].append({'ref': 'LIMITER', 'value': '100', 'libsource': {'lib': 'Device', 'part': 'R'}})
                board_pin = data['nets'][2]['nodes'].pop(0)
                data['nets'][2]['nodes'].append({'ref': 'LIMITER', 'pin': '1', 'pinfunction': 'unknown', 'pintype': 'passive'})
                data['nets'].append({'code': '200', 'name': 'SDA', 'nodes': [board_pin, {'ref': 'LIMITER', 'pin': '2', 'pinfunction': 'unknown', 'pintype': 'passive'}]})
            r = self.review(data)
            self.assertEqual(next(p for p in r['i2c']['checks'] if p['signal'] == 'SDA')['status'], 'unverified', mode)
            self.assertFalse(any(f['rule'].startswith('i2c_') and f['severity'] == 'warning' for f in r['findings']))

    def test_multiple_devices_on_same_bus_do_not_create_false_warnings(self):
        data = signal_circuit()
        second = copy.deepcopy(data['components'][1]); second['ref'] = 'DISPLAY_OTHER'
        data['components'].append(second)
        for net in data['nets']:
            for node in list(net['nodes']):
                if node['ref'] == 'PANEL9':
                    extra = copy.deepcopy(node); extra['ref'] = second['ref']; net['nodes'].append(extra)
        r = self.review(data)
        self.assertEqual(len(r['i2c']['checks']), 4)
        self.assertTrue(all(p['status'] == 'connected' for p in r['i2c']['checks']))
        self.assertEqual(r['summary']['warnings'], 0)

    def test_graph_mutation_reaches_chat_and_does_not_leak_across_uploads(self):
        first, second = self.save(signal_circuit()), self.save(signal_circuit())
        g = self.store.db.select_graph(self.store.graph_name(first))
        g.query('MATCH (p:Pin {id:$id})-[e:ON_NET]->() DELETE e', {'id': _json(['PANEL9', '4'])})
        r = execute_tool(self.store, first, 'check_rules', {})
        self.assertEqual(next(p for p in r['i2c']['checks'] if p['signal'] == 'SDA')['status'], 'unconnected')
        self.assertEqual(check_rules(self.store, second)['summary']['warnings'], 0)

    def test_timeout_and_changed_pin_rows_never_become_wiring_verdicts(self):
        cid = self.save(signal_circuit()); facts = self.store.review_facts(cid)
        g = self.store.db.select_graph(self.store.graph_name(cid))
        with patch.object(self.store.db, 'select_graph', return_value=g):
            with patch.object(g, 'ro_query', side_effect=ResponseError('timeout')):
                with self.assertRaises(StorageUnavailable): i2c_review(self.store, cid, facts)
            with patch.object(g, 'ro_query') as query:
                query.return_value.result_set = []
                with self.assertRaises(StorageUnavailable): i2c_review(self.store, cid, facts)
