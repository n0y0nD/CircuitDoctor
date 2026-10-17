"""Real KiCad 10.0.7 exports through upload, database, review and chat tools.

Fixtures use official Uno R3/classic Nano symbols, arbitrary references and
neutral net labels. A7 5V -> R12 -> J9 is normal; *_short also joins board GND
to that supply net. J9 is an unspecified external load, not a known device.
These test files are not presented as examples in the application.
Run with CIRCUITDOCTOR_TEST_DB=1 python -m unittest discover -s tests -q.
"""
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from circuitdoctor.api import app
from circuitdoctor.storage import get_store

FIXTURES = Path(__file__).parent / 'fixtures' / 'kicad'


def reply(parts):
    return {'candidates': [{'content': {'role': 'model', 'parts': parts}, 'finishReason': 'STOP'}]}


@unittest.skipUnless(os.environ.get('CIRCUITDOCTOR_TEST_DB') == '1', 'requires local FalkorDB')
class UploadedCircuitWorkflowTests(unittest.TestCase):
    def test_kicad_uno_and_nano_normal_and_short_circuits(self):
        store = get_store()
        with TestClient(app) as client:
            for filename in ('uno_normal.net', 'uno_short.net', 'nano_normal.net', 'nano_short.net'):
                file = FIXTURES / filename
                with self.subTest(file=file.name):
                    upload = client.post('/api/circuits', params={'filename': file.name}, content=file.read_bytes())
                    self.assertEqual(upload.status_code, 201, upload.text)
                    saved = upload.json()
                    self.addCleanup(store.db.select_graph(saved['graph_name']).delete)
                    cid = saved['circuit_id']
                    route = f'/api/circuits/{cid}'
                    restored = client.get(route).json()
                    self.assertEqual(restored['storage']['filename'], file.name)
                    self.assertEqual(len(restored['components']), 3)
                    review = client.post(route + '/review').json()
                    faulty = '_short' in file.stem
                    self.assertEqual([f['rule'] for f in review['findings']], ['power_ground_short'] if faulty else [])
                    self.assertEqual(set(review['electrical']['unknown_components']), {'R12', 'J9'})
                    supply = next(n for n in restored['nets'] if n['name'] == '/SUPPLY')
                    expected_paths = {('c:' + p['ref'], 'p:["' + p['ref'] + '","' + p['pin'] + '"]', 'n:' + supply['code']) for p in supply['nodes']}
                    if faulty:
                        finding = review['findings'][0]
                        self.assertEqual(finding['selection'], {'net_code': supply['code']})
                        self.assertEqual({tuple(p) for p in finding['evidence']['paths']}, expected_paths)
                    trace = client.post(route + '/power-trace', json={'net_name': '/SUPPLY'})
                    self.assertEqual(trace.status_code, 200, trace.text)
                    self.assertEqual(set(trace.json()['connected_parts']), {'A7', 'R12', 'J9'} if faulty else {'R12'})
                    self.assertEqual(bool(trace.json()['warnings']), faulty)
                    explanation = client.post(route + '/explain', json={'net_name': '/LOAD_INPUT'}).json()
                    self.assertEqual({p[0] for p in explanation['evidence']['paths']}, {'c:R12', 'c:J9'})
                    # Mock only the provider; the agent tools and graph are real.
                    calls = [{'functionCall': {'name': name, 'args': args}} for name, args in [
                        ('check_rules', {}), ('trace_power', {'net_name': '/SUPPLY'}),
                        ('explain_net', {'net_name': '/LOAD_INPUT'})]]
                    with patch('circuitdoctor.chat.api_key', return_value='synthetic-test-key'), patch('circuitdoctor.chat.generate', side_effect=[reply(calls), reply([{'text': 'Test response [E1] [E2] [E3].'}])]):
                        answer = client.post(route + '/chat', json={'message': 'Review this circuit and inspect its supply.'})
                    self.assertEqual(answer.status_code, 200, answer.text)
                    result = answer.json()
                    self.assertEqual(result['tool_calls'], 3)
                    self.assertEqual(result['evidence'][1]['result'], review)
                    for item in result['evidence']:
                        self.assertEqual(item['result']['circuit_id'], cid)
                        self.assertEqual(item['result']['source'], 'falkordb')
                    self.assertEqual(next(e['result']['evidence'] for e in result['evidence'] if e['tool'] == 'trace_power'), trace.json()['evidence'])
