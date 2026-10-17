import copy
import os
import unittest
from unittest.mock import patch
from redis.exceptions import ResponseError
from circuitdoctor.pullups import resistance, pullup_review, PULLUP_QUERY
from circuitdoctor.i2c import i2c_review
from circuitdoctor.review import check_rules
from circuitdoctor.chat import execute_tool
from circuitdoctor.storage import get_store, StorageUnavailable, _json
from test_i2c import signal_circuit


def pullup_circuit(board='Arduino_UNO_R3'):
    data = signal_circuit(board)
    for code, ref, part in [('100','BIAS_DATA','R'), ('101','BIAS_CLOCK','R_Small')]:
        data['components'].append({'ref':ref,'value':'4k7','libsource':{'lib':'Device','part':part}})
        for net, number in [(next(n for n in data['nets'] if n['code']==code),'1'), (data['nets'][1],'2')]:
            net['nodes'].append({'ref':ref,'pin':number,'pinfunction':'unknown','pintype':'passive'})
    return data


class ResistanceTests(unittest.TestCase):
    def test_only_explicit_values_are_parsed(self):
        for value, expected in [('4k7',4700), ('4.7k',4700), ('4.7 kΩ',4700), ('4700',4700), ('R47',.47), ('1M',1000000), ('1M2',1200000), ('0R',0), ('0',0), ('DNP',None), ('4k7 1%',None), ('100m',None), ('R',None), ('-2',None), ('nan',None)]:
            self.assertEqual(resistance(value),expected,value)


@unittest.skipUnless(os.environ.get('CIRCUITDOCTOR_TEST_DB')=='1','requires local FalkorDB')
class PullupTests(unittest.TestCase):
    def setUp(self): self.store=get_store()
    def save(self,data):
        r=self.store.save(data)
        self.addCleanup(self.store.db.select_graph(r['graph_name']).delete)
        return r['circuit_id']
    def review(self,data): return check_rules(self.store,self.save(data))

    def test_external_routes_on_both_boards_with_exact_evidence(self):
        for board in ('Arduino_UNO_R3','Arduino_Nano_v3.x'):
            r=self.review(pullup_circuit(board))
            self.assertEqual(r['summary']['warnings'],0)
            self.assertEqual([p['status'] for p in r['pullups']['checks']],['external_path_found']*2)
            self.assertIn(PULLUP_QUERY,[q['cypher'] for q in r['queries']])
            data=next(p for p in r['pullups']['checks'] if p['signal']=='SDA')
            self.assertEqual(data['paths'][0]['resistor'],'BIAS_DATA')
            self.assertEqual(data['paths'][0]['resistance_ohms'],4700)
            self.assertEqual(data['paths'][0]['nominal_voltage'],3.3)
            ids={n['id'] for n in data['evidence']['nodes']}
            self.assertTrue({'n:100','n:008','p:["BIAS_DATA","1"]','p:["BIAS_DATA","2"]','p:["PANEL9","4"]'} <= ids)
            self.assertNotIn('n:101',ids)
            self.assertNotIn('p:["BIAS_CLOCK","2"]',ids)
            self.assertNotIn('p:["PANEL9","2"]',ids)
            self.assertEqual(len([f for f in r['findings'] if f['rule']=='i2c_pullup_check']),2)

    def test_no_external_resistors_never_means_missing_pullups(self):
        r=self.review(signal_circuit())
        self.assertEqual(r['summary']['warnings'],0)
        for p in r['pullups']['checks']:
            self.assertEqual(p['status'],'unverified')
            self.assertIn('module may already include',p['message'])
            self.assertEqual(p['paths'],[])

    def test_one_line_only_and_zero_or_unknown_values_are_not_a_pass(self):
        for value in ('0R','DNP','R'):
            data=pullup_circuit();data['components'][2]['value']=value
            r=self.review(data)
            sda=next(p for p in r['pullups']['checks'] if p['signal']=='SDA')
            self.assertEqual(sda['status'],'unverified')
            self.assertEqual(sda['paths'][0]['status'],'unverified_value')
            self.assertEqual(r['summary']['warnings'],0)
        data=pullup_circuit()
        for n in data['nets']: n['nodes']=[p for p in n['nodes'] if p['ref']!='BIAS_DATA']
        r=self.review(data)
        self.assertEqual({p['signal']:p['status'] for p in r['pullups']['checks']},{'SDA':'unverified','SCL':'external_path_found'})

    def test_ground_series_unknown_part_and_unknown_rail_do_not_count(self):
        for mode in ('ground','series','unknown_resistor','third_pin','unknown_supply','conflicting_supply','extra_source'):
            data=pullup_circuit()
            if mode in ('ground','series'):
                node=next(p for p in data['nets'][1]['nodes'] if p['ref']=='BIAS_DATA')
                data['nets'][1]['nodes'].remove(node)
                data['nets'][0 if mode=='ground' else 3]['nodes'].append(node)
            elif mode=='unknown_resistor': data['components'][2]['libsource']['lib']='Custom'
            elif mode=='third_pin': data['nets'][1]['nodes'].append({'ref':'BIAS_DATA','pin':'3','pinfunction':'unknown','pintype':'passive'})
            elif mode=='unknown_supply':
                data['components'][0]['libsource']['lib']='Custom'
                data['nets'][1]['name']='3.3V'
            elif mode=='conflicting_supply': data['nets'][1]['nodes'].append(copy.deepcopy(data['nets'][0]['nodes'][0]))
            else:
                data['components'].append({'ref':'EXTERNAL','value':'supply','libsource':{'lib':'Custom','part':'Supply'}})
                data['nets'][1]['nodes'].append({'ref':'EXTERNAL','pin':'1','pinfunction':'unknown','pintype':'power_out'})
            r=self.review(data)
            sda=next(p for p in r['pullups']['checks'] if p['signal']=='SDA')
            self.assertEqual(sda['status'],'unverified',mode)
            self.assertEqual(sda['paths'],[],mode)

    def test_shared_bus_parallel_resistors_and_duplicate_rail_pins(self):
        data=pullup_circuit()
        extra=copy.deepcopy(data['components'][2]);extra['ref']='EXTRA_BIAS';data['components'].append(extra)
        for net in data['nets']:
            for p in list(net['nodes']):
                if p['ref']=='BIAS_DATA':
                    duplicate=copy.deepcopy(p);duplicate['ref']='EXTRA_BIAS';net['nodes'].append(duplicate)
        data['libparts'][0]['pins'].append({'num':'EXTRA_RAIL','name':'+3V3','type':'power_out'})
        data['nets'][1]['nodes'].append({'ref':'CTRL42','pin':'EXTRA_RAIL','pinfunction':'+3V3','pintype':'power_out'})
        r=self.review(data)
        sda=next(p for p in r['pullups']['checks'] if p['signal']=='SDA')
        self.assertEqual(len(sda['paths']),2)
        self.assertEqual({p['resistor'] for p in sda['paths']},{'BIAS_DATA','EXTRA_BIAS'})

    def test_unknown_device_and_conflicting_signal_metadata_are_not_inferred(self):
        data=pullup_circuit();data['components'][1]['libsource']['lib']='Custom'
        self.assertEqual(self.review(data)['pullups']['checks'],[])
        data=pullup_circuit();data['nets'][2]['nodes'][1]['pinfunction']='SCL'
        sda=next(p for p in self.review(data)['pullups']['checks'] if p['signal']=='SDA')
        self.assertEqual(sda['status'],'unverified');self.assertEqual(sda['paths'],[])

    def test_new_upload_and_graph_mutation_reach_chat_without_leaks(self):
        first=self.save(pullup_circuit());second=self.save(pullup_circuit())
        g=self.store.db.select_graph(self.store.graph_name(first))
        g.query('MATCH (p:Pin {id:$id})-[e:ON_NET]->() DELETE e',{'id':_json(['BIAS_DATA','2'])})
        r=execute_tool(self.store,first,'check_rules',{})
        self.assertEqual(next(p for p in r['pullups']['checks'] if p['signal']=='SDA')['status'],'unverified')
        self.assertEqual(check_rules(self.store,second)['pullups']['external_paths'],2)
        corrected=self.review(pullup_circuit())
        self.assertEqual(corrected['pullups']['external_paths'],2)

    def test_timeout_and_missing_rows_are_not_verdicts(self):
        cid=self.save(pullup_circuit());facts=self.store.review_facts(cid)
        i2c=i2c_review(self.store,cid,facts)['coverage']
        g=self.store.db.select_graph(self.store.graph_name(cid))
        with patch.object(self.store.db,'select_graph',return_value=g):
            with patch.object(g,'ro_query',side_effect=ResponseError('timeout')):
                with self.assertRaises(StorageUnavailable): pullup_review(self.store,cid,facts,i2c)
            with patch.object(g,'ro_query') as q:
                q.return_value.result_set=[]
                with self.assertRaises(StorageUnavailable): pullup_review(self.store,cid,facts,i2c)
