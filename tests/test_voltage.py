"""Exercise voltage checks against actual graph wiring, not user labels."""
import copy
import os
import unittest
from unittest.mock import patch
from redis.exceptions import ResponseError
from circuitdoctor.chat import execute_tool
from circuitdoctor.review import check_rules
from circuitdoctor.storage import get_store, StorageUnavailable, _json
from circuitdoctor.voltage import voltage_review, VOLTAGE_QUERY
from test_requirements import required_circuit


@unittest.skipUnless(os.environ.get('CIRCUITDOCTOR_TEST_DB') == '1', 'requires local FalkorDB')
class VoltageTests(unittest.TestCase):
    def setUp(self):
        self.store = get_store()

    def save(self, data):
        saved = self.store.save(data)
        self.addCleanup(self.store.db.select_graph(saved['graph_name']).delete)
        return saved['circuit_id']

    def review(self, data):
        return check_rules(self.store, self.save(data))

    def test_nominal_3v3_and_5v_both_in_oled_range_on_both_boards(self):
        for board in ('Arduino_UNO_R3', 'Arduino_Nano_v3.x'):
            for label, value in [('+3V3', 3.3), ('+5V', 5.0)]:
                data = required_circuit(board=board)
                data['libparts'][0]['pins'][1]['name'] = label
                r = self.review(data)
                check = r['voltage']['checks'][0]
                self.assertEqual(check['status'], 'within_range')
                self.assertEqual(check['nominal_voltage'], value)
                self.assertEqual(check['operating_range'], {'min': 3.0, 'max': 5.0})
                self.assertEqual(r['summary']['warnings'], 0)
                self.assertIn(VOLTAGE_QUERY, [q['cypher'] for q in r['queries']])
                self.assertTrue(check['sources'])

    def test_vcc_to_ground_warns_and_corrected_upload_clears_it(self):
        data = required_circuit()
        power = data['nets'][1]['nodes'].pop()
        data['nets'][0]['nodes'].append(power)
        r = self.review(data)
        f = next(f for f in r['findings'] if f['rule'] == 'supply_voltage_mismatch')
        self.assertEqual(f['selection'], {'ref': 'PANEL9', 'pin': '2'})
        self.assertIn('0V nominal', f['message'])
        self.assertIn('3–5V', f['message'])
        self.assertTrue({'p:["PANEL9","2"]','p:["PANEL9","1"]','p:["CTRL42","RETURN"]','n:007'}.issubset({n['id'] for n in f['evidence']['nodes']}))
        self.assertEqual(f['specifications']['nominal_voltage'], 0)
        self.assertEqual(self.review(required_circuit())['summary']['warnings'], 0)

    def test_ambiguous_lcd_variant_is_never_assumed_5v(self):
        r = self.review(required_circuit(lcd=True))
        self.assertEqual(r['voltage']['checks'][0]['status'], 'unverified')
        self.assertIn('variants', r['voltage']['checks'][0]['reason'])
        self.assertEqual(r['summary']['warnings'], 0)

    def test_names_values_external_supplies_do_not_establish_voltages(self):
        data = required_circuit()
        data['components'][0]['libsource'] = {'lib': 'Custom', 'part': 'Supply'}
        data['nets'][1]['name'] = '5V'
        r = self.review(data)
        self.assertEqual(r['voltage']['checks'][0]['status'], 'unverified')
        self.assertEqual(r['summary']['warnings'], 0)
        data['components'][1]['libsource'] = {'lib': 'Custom', 'part': 'Display'}
        data['components'][1]['value'] = 'ER_OLEDM0.91_1x-I2C'
        self.assertEqual(self.review(data)['voltage']['checks'], [])

    def test_missing_ground_conflicting_names_and_resistor_supply_are_unverified(self):
        for mode in ('missing_ground','conflicting_names','resistor','different_board','additional_source','conflicting_rails'):
            with self.subTest(mode=mode):
                data = required_circuit()
                if mode == 'missing_ground':
                    data['nets'][0]['nodes'].pop()
                elif mode == 'conflicting_names':
                    data['nets'][1]['nodes'][1]['pinfunction'] = 'GND'
                elif mode == 'resistor':
                    data['components'].append({'ref':'LIMITER','value':'100','libsource':{'lib':'Device','part':'R'}})
                    target = data['nets'][1]['nodes'].pop()
                    data['nets'][1]['nodes'].append({'ref':'LIMITER','pin':'1','pintype':'passive','pinfunction':'unknown'})
                    data['nets'].append({'code':'009','name':'3V3','nodes':[target,{'ref':'LIMITER','pin':'2','pintype':'passive','pinfunction':'unknown'}]})
                elif mode == 'different_board':
                    other=copy.deepcopy(data['components'][0]);other['ref']='OTHER';data['components'].append(other)
                    data['nets'][0]['nodes'][0]['ref']='OTHER'
                else:
                    lib = {'lib':'Custom','part':'Supply'} if mode == 'additional_source' else {'lib':'MCU_Module','part':'Arduino_Nano_v3.x'}
                    data['components'].append({'ref':'EXTRA','value':'supply','libsource':lib})
                    data['nets'][1]['nodes'].append({'ref':'EXTRA','pin':'out','pinfunction':'+5V','pintype':'power_out'})
                r = self.review(data)
                self.assertEqual(r['voltage']['checks'][0]['status'], 'unverified')
                self.assertFalse(any(f['rule']=='supply_voltage_mismatch' for f in r['findings']))

    def test_chat_tool_reads_graph_changes_and_keeps_other_upload_isolated(self):
        first, second = self.save(required_circuit()), self.save(required_circuit())
        g = self.store.db.select_graph(self.store.graph_name(first))
        g.query('MATCH (p:Pin {id:$id})-[e:ON_NET]->() DELETE e',{'id':_json(['PANEL9','2'])})
        g.query('MATCH (p:Pin {id:$id}), (n:Net {code:$net}) CREATE (p)-[:ON_NET {position:9}]->(n)',{'id':_json(['PANEL9','2']),'net':'007'})
        self.assertEqual(execute_tool(self.store,first,'check_rules',{})['voltage']['checks'][0]['status'],'outside_range')
        self.assertEqual(execute_tool(self.store,second,'check_rules',{})['voltage']['checks'][0]['status'],'within_range')

    def test_timeout_is_not_a_voltage_verdict(self):
        cid = self.save(required_circuit()); facts = self.store.review_facts(cid)
        graph = self.store.db.select_graph(self.store.graph_name(cid))
        with patch.object(self.store.db,'select_graph',return_value=graph), patch.object(graph,'ro_query',side_effect=ResponseError('timeout')):
            with self.assertRaises(StorageUnavailable): voltage_review(self.store,cid,facts)
