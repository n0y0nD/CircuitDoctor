"""Required supply-pin checks using verified part identities and graph wiring.

Only explicit catalog requirements can promote an unconnected pin to a warning.
Unknown supply arrangements remain unverified. ON_NET traversal never crosses a
component internally or treats a net's name as proof of a supply.
"""
from functools import lru_cache
import json
from pathlib import Path

from redis.exceptions import RedisError
from .parts import identify, pin_spec
from .storage import StorageUnavailable, _json
from .tools import describe_connection

REQUIRED_QUERY = """UNWIND $checks AS check
MATCH (p:Pin {id:check.id})
OPTIONAL MATCH route=(p)-[:ON_NET*2..2]-(peer:Pin)
WHERE peer.id <> p.id
RETURN p.id, collect(DISTINCT peer.id),
       collect(DISTINCT CASE WHEN peer.id IN check.anchors THEN peer.id ELSE null END)
ORDER BY p.id"""


@lru_cache(maxsize=1)
def required_catalog():
    return json.loads(Path(__file__).with_name('required_parts.json').read_text())


def required_connections(store, circuit_id, facts):
    catalog = required_catalog()
    known = {(p['match']['lib'], p['match']['part']): p for p in catalog['parts']}
    components = {c['ref']: c for c in facts['components']}
    pins = {(p['ref'], p['pin']): p for p in facts['pins']}
    anchors = {'ground': [], 'power': []}
    for pin in facts['pins']:
        board = identify(components[pin['ref']])
        if not board:
            continue
        spec, conflict = pin_spec(board, pin)
        if spec and not conflict:
            if spec['role'] == 'ground':
                anchors['ground'].append(_json([pin['ref'], pin['pin']]))
            elif spec['role'] == 'rail' and 'IOREF' not in spec['names']:
                anchors['power'].append(_json([pin['ref'], pin['pin']]))
    recognized, skipped, checks, bindings = [], [], [], {}
    for ref, component in components.items():
        identity = component['libsource']
        part = known.get((identity['lib'], identity['part']))
        if not part:
            continue
        recognized.append({'ref': ref, 'name': part['name'], 'sources': part['sources']})
        for required in part['pins']:
            pin = pins.get((ref, required['number']))
            spec, conflict = pin_spec(part, pin) if pin else (None, None)
            # Exact symbol AND pin ID AND consistent names; no invented missing pins.
            if not pin or conflict or spec != required:
                skipped.append({'ref': ref, 'pin': required['number'],
                                'reason': 'Required pin is absent or its name metadata is missing/conflicting.'})
                continue
            identity = _json([ref, pin['pin']])
            checks.append({'id': identity, 'anchors': anchors[required['role']]})
            bindings[identity] = (pin, part, required)
    queries, findings, checked = [], [], []
    if checks:
        graph = store.db.select_graph(store.graph_name(circuit_id))
        try:
            rows = graph.ro_query(REQUIRED_QUERY, {'checks': checks}, timeout=5000).result_set
        except RedisError as exc:
            raise StorageUnavailable('Could not check required power/ground connections in FalkorDB. Please try again.') from exc
        queries.append({'cypher': REQUIRED_QUERY, 'parameters': {'checks': checks}})
        if len(rows) != len(checks):
            raise StorageUnavailable('Circuit pin data changed while checking. Reload the circuit and try again.')
        for identity, peers, reached in rows:
            pin, part, required = bindings[identity]
            role = required['role']
            name = required['names'][0]
            nets = [net for net in facts['nets'] if any(p['ref'] == pin['ref'] and p['pin'] == pin['pin'] for p in net['pins'])]
            evidence = describe_connection({'selected_pin': pin, 'nets': nets})['evidence']
            state = 'connected' if reached else 'unconnected' if not peers else 'unverified'
            checked.append({'ref': pin['ref'], 'pin': pin['pin'], 'name': name, 'role': role,
                            'status': state, 'anchors': [json.loads(a) for a in reached], 'evidence': evidence})
            if state == 'unconnected':
                title = f"{pin['ref']}: {name} connection is missing"
                message = f"The {name} pin on {pin['ref']} ({part['name']}) has no connection to another pin in this file. This part requires a {role} connection; it is a possible reason it may not work."
                suggestion = (f"Connect {pin['ref']} pin {pin['pin']} ({name}) to your circuit's ground, then export and upload the corrected file."
                              if role == 'ground' else f"Connect {pin['ref']} pin {pin['pin']} ({name}) to a suitable supply specified by its datasheet, then export and upload the corrected file.")
                findings.append({'rule': 'required_' + role + '_unconnected', 'severity': 'warning',
                                 'title': title, 'message': message, 'suggestion': suggestion,
                                 'pin': pin, 'evidence': evidence, 'sources': part['sources']})
            elif state == 'unverified':
                checked[-1]['reason'] = ('This pin is wired, but no direct wire route to an identified Arduino '
                                         + ('GND pin' if role == 'ground' else 'supply rail')
                                         + ' was found. An external supply or a path through another component may be valid; check the schematic.')
    return {'findings': findings, 'queries': queries, 'coverage': {
        'catalog_version': catalog['version'], 'recognized_parts': recognized,
        'checked_pins': len(checked), 'connected_pins': sum(p['status'] == 'connected' for p in checked),
        'missing_pins': sum(p['status'] == 'unconnected' for p in checked),
        'unverified_pins': [p for p in checked if p['status'] == 'unverified'],
        'skipped_pins': skipped, 'pins': checked,
        'scope': 'Required catalog pins; direct wire routes to known board rails/ground. No voltage or current verification.'}}
