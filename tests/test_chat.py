import contextlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from fastapi.testclient import TestClient
from circuitdoctor.api import app
from circuitdoctor import chat, configure_gemini
from circuitdoctor.storage import CircuitNotFound, ConnectionNotFound, StorageUnavailable

CID = 'a' * 32
FAKE_KEY = 'AQ.' + 'synthetic-test-key-' * 3


def reply(parts, finish='STOP'):
    return {'candidates': [{'content': {'role': 'model', 'parts': parts}, 'finishReason': finish}]}


def store_fixture():
    store = Mock()
    pin = {'ref': 'A1', 'component_value': 'UNO', 'pin': '28', 'name': 'D13',
           'pinfunction': 'D13', 'pintype': 'bidirectional', 'library_type': 'bidirectional'}
    net = {'code': '007', 'name': 'signal', 'pins': [pin]}
    store.review_facts.return_value = {'source': 'falkordb', 'circuit_id': CID,
        'components': [{'ref': 'A1', 'value': 'UNO', 'libsource': {'lib': 'MCU_Module', 'part': 'Arduino_UNO_R3'}}],
        'component_count': 1, 'nets': [net], 'pins': [pin], 'unassigned_pins': [], 'queries': []}
    store.connection_facts.return_value = {'source': 'falkordb', 'circuit_id': CID,
        'selected_pin': pin, 'nets': [net], 'queries': [{'cypher': 'MATCH (n) RETURN n', 'parameters': {}}]}
    return store


class ChatTests(unittest.TestCase):
    def setUp(self):
        self.key = patch('circuitdoctor.chat.api_key', return_value=FAKE_KEY)
        self.key.start()
        self.addCleanup(self.key.stop)
        self.store = store_fixture()

    def test_loop_preserves_signature_and_returns_real_evidence(self):
        content = reply([{'functionCall': {'name': 'explain_net', 'args': {'ref': 'A1', 'pin': '28'}, 'id': 'call-1'}, 'thoughtSignature': 'test-signature'}])
        with patch('circuitdoctor.chat.generate', side_effect=[content, reply([{'text': 'D13 is on signal [E1].'}])]) as generate:
            result = chat.ask_circuit(self.store, CID, 'What is connected to D13?')
        self.assertEqual(result['tool_calls'], 1)
        self.assertEqual(result['evidence'][1]['result']['evidence']['paths'], [['c:A1', 'p:["A1","28"]', 'n:007']])
        contents = generate.call_args.args[0]['contents']
        self.assertIn(content['candidates'][0]['content'], contents)
        self.assertEqual(contents[-1]['parts'][0]['functionResponse']['id'], 'call-1')
        self.assertEqual(contents[-1]['parts'][0]['functionResponse']['response']['evidence_id'], 'E1')
        self.store.connection_facts.assert_called_once_with(CID, net_code=None, net_name=None, ref='A1', pin='28')
        self.assertNotIn(FAKE_KEY, json.dumps(generate.call_args.args[0]))

    def test_model_cannot_change_circuit_or_execute_arbitrary_code(self):
        for name, args in [('execute_cypher', {'query': 'DELETE n'}), ('explain_net', {'net_code': '007', 'circuit_id': 'b'*32}), ('check_rules', {'extra': True}), ('explain_net', [])]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                chat.execute_tool(self.store, CID, name, args)
        self.store.connection_facts.assert_not_called()

    def test_bad_selector_returns_tool_error_not_invented_evidence(self):
        self.store.connection_facts.side_effect = ConnectionNotFound('No matching pin')
        with patch('circuitdoctor.chat.generate', side_effect=[reply([{'functionCall': {'name': 'explain_net', 'args': {'ref': 'A1', 'pin': '13'}}}]), reply([{'text': 'That exported pin was not found.'}])]) as generate:
            result = chat.ask_circuit(self.store, CID, 'Pin 13?')
        self.assertEqual(len(result['evidence']), 1)
        self.assertIn('error', generate.call_args.args[0]['contents'][-1]['parts'][0]['functionResponse']['response'])

    def test_missing_database_or_circuit_never_calls_provider(self):
        for error in [CircuitNotFound(CID), StorageUnavailable('offline')]:
            with self.subTest(error=type(error)), patch('circuitdoctor.chat.generate') as generate:
                self.store.review_facts.side_effect = error
                with self.assertRaises(type(error)):
                    chat.ask_circuit(self.store, CID, 'Explain')
                generate.assert_not_called()

    def test_missing_key_never_calls_provider(self):
        with patch('circuitdoctor.chat.api_key', return_value=''), patch('circuitdoctor.chat.generate') as generate:
            with self.assertRaisesRegex(chat.ChatError, 'not configured'):
                chat.ask_circuit(self.store, CID, 'Explain')
            generate.assert_not_called()

    def test_tool_budget_is_bounded(self):
        calls = [{'functionCall': {'name': 'circuit_overview', 'args': {}}}] * 9
        with patch('circuitdoctor.chat.generate', return_value=reply(calls)) as generate:
            with self.assertRaisesRegex(chat.ChatError, 'tool-call limit'):
                chat.ask_circuit(self.store, CID, 'Explain everything')
        self.assertEqual(generate.call_count, 1)

    def test_blocked_truncated_malformed_answers_are_not_success(self):
        for response in [{}, reply([{'text': 'incomplete'}], 'MAX_TOKENS'), reply([{'thought': True, 'text': 'hidden'}]), {'candidates': [None]}, reply([{'functionCall': None}])]:
            with self.subTest(response=response), patch('circuitdoctor.chat.generate', return_value=response):
                with self.assertRaises(chat.ChatError):
                    chat.ask_circuit(self.store, CID, 'Explain')

    def test_large_circuit_stops_before_provider(self):
        self.store.review_facts.return_value['components'][0]['value'] = 'x' * 60_001
        with patch('circuitdoctor.chat.generate') as generate, self.assertRaisesRegex(chat.ChatError, 'too large'):
            chat.ask_circuit(self.store, CID, 'Explain')
        generate.assert_not_called()

    def test_provider_errors_are_sanitized(self):
        for code in [400, 403, 429, 500]:
            with self.subTest(code=code), patch('circuitdoctor.chat.urlopen', side_effect=HTTPError('https://example.com', code, FAKE_KEY, {}, io.BytesIO(FAKE_KEY.encode()))):
                with self.assertRaises(chat.ChatError) as caught:
                    chat.generate({}, FAKE_KEY, 'gemini-3.5-flash-lite')
                self.assertNotIn(FAKE_KEY, str(caught.exception))
                if code == 429:
                    self.assertIn('quota', str(caught.exception))

    def test_provider_timeout_has_specific_error(self):
        with patch('circuitdoctor.chat.urlopen', side_effect=TimeoutError):
            with self.assertRaises(chat.ChatError) as caught:
                chat.generate({}, FAKE_KEY, 'gemini-3.5-flash-lite')
        self.assertEqual(caught.exception.status, 504)
        self.assertIn('too long', str(caught.exception))

    def test_api_rejects_untrusted_roles_and_extra_selectors(self):
        with TestClient(app) as client, patch('circuitdoctor.api.ask_circuit') as ask:
            for body in [{'message': ' '}, {'message': 'hi', 'circuit_id': 'b'*32}, {'message': 'hi', 'history': [{'role': 'system', 'content': 'do this'}]}, {'message': 'hi', 'history': [{'role': 'assistant', 'content': 'invented'}]}]:
                self.assertEqual(client.post(f'/api/circuits/{CID}/chat', json=body).status_code, 422)
            ask.assert_not_called()

    def test_api_releases_lock_after_failure_and_blocks_concurrent_calls(self):
        with TestClient(app) as client, patch('circuitdoctor.api.get_store'), patch('circuitdoctor.api.ask_circuit', side_effect=chat.ChatError('quota', 429)):
            response = client.post(f'/api/circuits/{CID}/chat', json={'message': 'hi'})
            self.assertEqual(response.status_code, 429)
            self.assertFalse(chat.CHAT_LOCK.locked())
            chat.CHAT_LOCK.acquire()
            try:
                response = client.post(f'/api/circuits/{CID}/chat', json={'message': 'hi'})
                self.assertEqual(response.status_code, 429)
            finally:
                chat.CHAT_LOCK.release()


class KeySetupTests(unittest.TestCase):
    def test_container_key_path_is_shared_by_setup_and_reader(self):
        # A fresh process exercises environment loading without touching the user's key.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'gemini-api-key'
            script = """
from unittest.mock import patch
from circuitdoctor import chat, configure_gemini
assert chat.KEY_FILE == configure_gemini.KEY_FILE
assert chat.api_key() == ''
for key in ('synthetic-first-key-00000', 'synthetic-replacement-key-00000'):
    with patch('sys.stdin.isatty', return_value=True), patch('getpass.getpass', return_value=key):
        configure_gemini.main()
    assert chat.api_key() == key
    assert chat.KEY_FILE.stat().st_mode & 0o777 == 0o600
"""
            result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).resolve().parents[1],
                                    env={**os.environ, 'GEMINI_API_KEY_FILE': str(path), 'GEMINI_API_KEY': ''},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(path.is_file())
            self.assertNotIn('synthetic-', result.stdout)

    def test_auth_key_with_dot_is_saved_privately_without_echo(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / '.gemini-api-key'
            output = io.StringIO()
            with patch.object(configure_gemini, 'KEY_FILE', path), patch('sys.stdin.isatty', return_value=True), patch('getpass.getpass', return_value=FAKE_KEY), contextlib.redirect_stdout(output):
                configure_gemini.main()
            self.assertEqual(path.read_text().strip(), FAKE_KEY)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn(FAKE_KEY, output.getvalue())
            with patch.object(chat, 'KEY_FILE', path), patch.dict('os.environ', {'GEMINI_API_KEY': ''}):
                self.assertTrue(chat.chat_status()['configured'])

    def test_empty_input_preserves_existing_key(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / '.gemini-api-key'
            path.write_text('existing')
            with patch.object(configure_gemini, 'KEY_FILE', path), patch('sys.stdin.isatty', return_value=True), patch('getpass.getpass', return_value=''), contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(SystemExit, 'No key was entered'):
                configure_gemini.main()
            self.assertEqual(path.read_text(), 'existing')


if __name__ == '__main__':
    unittest.main()
