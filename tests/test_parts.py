"""Board specifications must not turn guessed labels into electrical facts."""
import os
import unittest
from fastapi.testclient import TestClient
from circuitdoctor.api import app
from circuitdoctor.parser import parse_netlist
from circuitdoctor.parts import catalog, identify, pin_spec
from circuitdoctor.storage import get_store


def rail_circuit(part='Arduino_UNO_R3', names=('+5V', '+3V3'), lib='MCU_Module'):
    # Exported pin IDs are deliberately not physical Arduino header numbers.
    pins = ''.join(f'(pin (num P{i}) (name "{name}") (type passive))' for i, name in enumerate(names))
    members = ''.join(f'(node (ref CTRL9) (pin P{i}) (pinfunction "{name}_P{i}") (pintype passive))' for i, name in enumerate(names))
    return f'''(export (components (comp (ref CTRL9) (value "{part}") (libsource (lib "{lib}") (part "{part}"))))
      (libparts (libpart (lib "{lib}") (part "{part}") (pins {pins})))
      (nets (net (code 007) (name arbitrary) {members})))'''


class CatalogTests(unittest.TestCase):
    def test_exact_identity_only(self):
        self.assertIsNone(identify({'value':'Arduino_UNO_R3'}))
        self.assertIsNone(identify({'libsource':{'lib':'Custom', 'part':'Arduino_UNO_R3'}}))
        self.assertIsNone(identify({'libsource':{'lib':'MCU_Module', 'part':'Arduino_Nano_Every'}}))
        self.assertEqual(len(catalog()['parts']), 2)

    def test_ambiguous_pin_metadata_is_not_overridden(self):
        part = identify({'libsource':{'lib':'MCU_Module', 'part':'Arduino_UNO_R3'}})
        for name, function in [('+5V','+3V3_007'), ('D13','+5V_007')]:
            self.assertEqual(pin_spec(part, {'name':name,'pinfunction':function,'pin':'007'}), (None,'conflicting_pin_metadata'))
        self.assertEqual(pin_spec(part, {'name':'unknown','pinfunction':'unknown','pin':'5'}), (None,None))
        spec, error = pin_spec(part, {'name':'+5V','pinfunction':'+5V_007','pin':'007'})
        self.assertIsNone(error)
        self.assertEqual(spec['nominal_voltage'], 5)
        self.assertEqual(pin_spec(part, {'name':'unknown','pinfunction':'+5V_7','pin':'007'}), (None,None))


@unittest.skipUnless(os.environ.get('CIRCUITDOCTOR_TEST_DB') == '1', 'requires local FalkorDB')
class ElectricalReviewTests(unittest.TestCase):
    def setUp(self):
        self.store = get_store()
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def review(self, data):
        saved = self.store.save(data)
        self.addCleanup(self.store.db.select_graph(saved['graph_name']).delete)
        response = self.client.post(f"/api/circuits/{saved['circuit_id']}/review")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_both_supported_boards_have_source_backed_rail_conflict_evidence(self):
        for part in ('Arduino_UNO_R3','Arduino_Nano_v3.x'):
            with self.subTest(part=part):
                result = self.review(parse_netlist(rail_circuit(part)))
                self.assertEqual(result['summary']['warnings'], 1)
                finding = result['findings'][0]
                self.assertEqual(finding['rule'], 'voltage_rail_conflict')
                self.assertEqual({p['nominal_voltage'] for p in finding['specifications']}, {3.3,5})
                self.assertEqual(finding['selection'], {'net_code':'007'})
                self.assertIn(['c:CTRL9','p:["CTRL9","P0"]','n:007'], finding['evidence']['paths'])
                self.assertTrue(all(s['url'].startswith('https://docs.arduino.cc/') for s in finding['sources']))
                self.assertEqual(result['electrical']['matched_power_pins'], 2)

    def test_direct_ground_short_but_gpio_or_same_voltage_is_not_a_rail_fault(self):
        for names, expected in [(('+5V','GND'),['power_ground_short']), (('+3V3','GND'),['power_ground_short']),
                                (('+5V','GND','+3V3'),['power_ground_short','voltage_rail_conflict']),
                                (('+5V','A0'),[]), (('GND','D13'),[]), (('+5V','IOREF'),[])]:
            with self.subTest(names=names):
                result = self.review(parse_netlist(rail_circuit(names=names)))
                self.assertEqual([f['rule'] for f in result['findings']], expected)

    def test_unknown_boards_and_missing_pin_names_do_not_inherit_voltage_assumptions(self):
        for lib in ('Custom','MCU_Module'):
            data = parse_netlist(rail_circuit(lib=lib))
            if lib == 'MCU_Module':
                data['libparts'] = []
                for pin in data['nets'][0]['nodes']:
                    pin['pinfunction'] = 'unknown'
            data['nets'][0]['name'] = '+5V-short-to-3V3'
            result = self.review(data)
            self.assertEqual(result['summary']['warnings'], 0)
            self.assertEqual(result['electrical']['matched_power_pins'], 0)
            self.assertTrue(result['cannot_verify'])

    def test_conflicting_metadata_is_reported_as_coverage_gap(self):
        data = parse_netlist(rail_circuit())
        data['nets'][0]['nodes'][0]['pinfunction'] = 'D13'
        result = self.review(data)
        self.assertEqual(result['summary']['warnings'], 0)
        self.assertEqual(result['electrical']['conflicting_pin_metadata'], [{'ref':'CTRL9','pin':'P0'}])
        self.assertTrue(any(item['check']=='Conflicting pin metadata' for item in result['cannot_verify']))

    def test_no_voltage_propagation_across_resistors_or_other_components(self):
        data = parse_netlist(rail_circuit())
        members = data['nets'][0]['nodes']
        data['components'].append({'ref':'R77','value':'330','libsource':{'lib':'Device','part':'R'}})
        def resistor_pin(pin):
            return {'ref':'R77','pin':pin,'pinfunction':'unknown','pintype':'passive'}
        data['nets'] = [{'code':'A','name':'left','nodes':[members[0],resistor_pin('1')]},
                        {'code':'B','name':'right','nodes':[members[1],resistor_pin('2')]}]
        result = self.review(data)
        self.assertEqual(result['summary']['warnings'], 0)
        self.assertEqual(result['electrical']['unknown_components'], ['R77'])
