"""Revision comparison must distinguish confirmed repairs from lost evidence."""
import copy
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from circuitdoctor.api import app
from circuitdoctor.compare import compare_circuits
from circuitdoctor.parser import parse_netlist
from circuitdoctor.storage import get_store, StorageUnavailable
from test_requirements import required_circuit
from test_i2c import signal_circuit


@unittest.skipUnless(os.environ.get('CIRCUITDOCTOR_TEST_DB') == '1', 'requires local FalkorDB')
class CompareTests(unittest.TestCase):
    def setUp(self):
        self.store = get_store()
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def save(self, circuit):
        receipt = self.store.save(circuit)
        self.addCleanup(self.store.db.select_graph(receipt['graph_name']).delete)
        return receipt['circuit_id']

    def compare(self, before, after):
        a,b = self.save(before),self.save(after)
        response = self.client.post(f'/api/circuits/{a}/compare',json={'corrected_id':b})
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def broken(self):
        d = required_circuit()
        d['nets'][0]['nodes'].pop()
        return d

    def test_required_return_repaired_with_before_after_evidence(self):
        r = self.compare(self.broken(), required_circuit())
        self.assertEqual(r['summary']['resolved'],1)
        self.assertEqual(r['warnings'][0]['rule'],'required_ground_unconnected')
        self.assertEqual(r['summary']['new'],0)
        self.assertTrue(r['warnings'][0]['before']['nodes'])
        self.assertTrue(r['warnings'][0]['after']['edges'])
        self.assertEqual(r['summary']['added_connections'],1)

    def test_unchanged_fault_survives_net_renumbering_and_renaming(self):
        a = self.broken(); b = copy.deepcopy(a)
        for i,n in enumerate(b['nets']):
            n['code'] = str(i+500); n['name'] = 'renamed '+str(i)
        r = self.compare(a,b)
        self.assertEqual(r['summary']['persists'],1)
        self.assertEqual(r['summary']['resolved'],0)
        self.assertEqual(r['connections'],[])

    def test_component_removed_or_identity_changed_never_counts_as_fixed(self):
        for mode in ['remove','identity','metadata','ref']:
            b=required_circuit()
            if mode=='remove':
                b['components'].pop()
                for n in b['nets']: n['nodes']=[p for p in n['nodes'] if p['ref']!='PANEL9']
            elif mode=='identity': b['components'][1]['libsource']={'lib':'Custom','part':'Unknown'}
            elif mode=='metadata': b['libparts'][1]['pins'][0]['name']='unknown'
            else:
                b['components'][1]['ref']='RENAMED'
                for n in b['nets']:
                    for p in n['nodes']:
                        if p['ref']=='PANEL9': p['ref']='RENAMED'
            with self.subTest(mode=mode):
                r=self.compare(self.broken(),b)
                self.assertEqual(r['summary']['resolved'],0)
                self.assertEqual(r['summary']['unverified'],1)
                self.assertFalse(r['matching']['comparable'])

    def test_wire_to_unknown_peer_is_not_a_verified_return_fix(self):
        b=required_circuit()
        b['components'].append({'ref':'X','value':'unknown','libsource':{'lib':'Custom','part':'External'}})
        b['nets'][0]['nodes'][0]={'ref':'X','pin':'g','pinfunction':'unknown','pintype':'unknown'}
        r=self.compare(self.broken(),b)
        self.assertEqual(r['summary']['resolved'],0)
        self.assertEqual(r['summary']['unverified'],1)

    def test_new_warning_and_fixed_voltage_are_separate(self):
        wrong=required_circuit()
        wrong['nets'][0]['nodes'].append(wrong['nets'][1]['nodes'].pop())
        r=self.compare(wrong,required_circuit())
        self.assertTrue(any(w['rule']=='supply_voltage_mismatch' and w['status']=='resolved' for w in r['warnings']))
        reversed_result=self.compare(required_circuit(),wrong)
        self.assertTrue(any(w['status']=='new' for w in reversed_result['warnings']))
        self.assertIn('1 new wiring warning',reversed_result['message'])
        self.assertNotIn('no supported warnings',reversed_result['message'])

    def test_i2c_swap_repair_and_partial_repair(self):
        clean=signal_circuit(); wrong=copy.deepcopy(clean)
        wrong['nets'][2]['nodes'][0],wrong['nets'][3]['nodes'][0]=wrong['nets'][3]['nodes'][0],wrong['nets'][2]['nodes'][0]
        r=self.compare(wrong,clean)
        self.assertEqual(r['summary']['resolved'],2)
        partial=copy.deepcopy(clean); partial['nets'][3]['nodes'].pop()
        r=self.compare(wrong,partial)
        self.assertEqual(r['summary']['resolved'],1)
        self.assertEqual(r['summary']['unverified'],1)
        self.assertEqual(r['summary']['new'],1)

    def test_real_kicad_rail_short_repair_on_both_boards(self):
        fixtures=Path(__file__).parent/'fixtures'/'kicad'
        for board in ['uno','nano']:
            r=self.compare(parse_netlist((fixtures/f'{board}_short.net').read_text()),parse_netlist((fixtures/f'{board}_normal.net').read_text()))
            self.assertEqual(r['summary']['resolved'],1,r)
            self.assertEqual(r['warnings'][0]['rule'],'power_ground_short')

    def test_no_warning_is_not_a_repair_and_same_upload_is_read_only(self):
        cid=self.save(required_circuit())
        graph=self.store.db.select_graph(self.store.graph_name(cid))
        original=self.store.read(cid)
        with patch.object(graph,'query',side_effect=AssertionError('comparison must not write')):
            with patch.object(self.store.db,'select_graph',return_value=graph):
                r=compare_circuits(self.store,cid,cid)
        self.assertEqual(r['summary']['resolved'],0)
        self.assertEqual(r['connections'],[])
        self.assertIn('same saved upload',r['message'])
        self.assertEqual(self.store.read(cid),original)

    def test_invalid_missing_and_unavailable_inputs(self):
        cid=self.save(required_circuit())
        self.assertEqual(self.client.post(f'/api/circuits/{cid}/compare',json={'corrected_id':'bad'}).status_code,422)
        self.assertEqual(self.client.post(f'/api/circuits/{cid}/compare',json={'corrected_id':'0'*32}).status_code,404)
        with patch('circuitdoctor.api.compare_circuits',side_effect=StorageUnavailable('offline')):
            self.assertEqual(self.client.post(f'/api/circuits/{cid}/compare',json={'corrected_id':cid}).status_code,503)

    def test_chat_rechecks_comparison_for_either_view_without_trusting_client_verdict(self):
        from circuitdoctor.chat import ask_circuit, ChatError
        a,b = self.save(self.broken()),self.save(required_circuit())
        reply={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'Ground restored [E2].'}]}}]}
        pair={'original_id':a,'corrected_id':b}
        for current,view in [(a,'earlier'),(b,'updated')]:
            with patch('circuitdoctor.chat.api_key',return_value='test-only'), patch('circuitdoctor.chat.generate',return_value=reply) as generate:
                r=ask_circuit(self.store,current,'What changed?',comparison=pair)
                fact=r['evidence'][2]['result']
                self.assertEqual(fact['viewing'],view)
                self.assertEqual(fact['summary']['resolved'],1)
                self.assertEqual(fact['original_id'],a)
                self.assertEqual(r['comparison'],pair)
                self.assertNotIn('queries',fact)
                self.assertIn('Fresh verify_fix evidence [E2]',generate.call_args.args[0]['contents'][0]['parts'][2]['text'])
        with patch('circuitdoctor.chat.generate') as generate:
            with self.assertRaises(ChatError):
                ask_circuit(self.store,'f'*32,'What changed?',comparison=pair)
            generate.assert_not_called()
        with patch('circuitdoctor.chat.api_key',return_value='test-only'), patch('circuitdoctor.chat.compare_circuits',side_effect=StorageUnavailable('offline')), patch('circuitdoctor.chat.generate') as generate:
            with self.assertRaises(StorageUnavailable):
                ask_circuit(self.store,a,'What changed?',comparison=pair)
            generate.assert_not_called()
        invalid={**pair,'resolved':True}
        self.assertEqual(self.client.post(f'/api/circuits/{a}/chat',json={'message':'What changed?','comparison':invalid}).status_code,422)
        with patch('circuitdoctor.api.ask_circuit',return_value={'answer':'ok'}) as ask:
            self.assertEqual(self.client.post(f'/api/circuits/{a}/chat',json={'message':'What changed?','comparison':pair}).status_code,200)
            self.assertEqual(ask.call_args.kwargs['comparison'],pair)
