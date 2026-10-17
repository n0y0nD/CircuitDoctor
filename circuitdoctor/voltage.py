"""Compare source-backed operating ranges against direct nominal board rails.

No voltage propagation through resistors, regulators, GPIOs or unknown supplies.
Net names and user values cannot establish voltages or component variants.
"""
from redis.exceptions import RedisError

from .parts import identify, pin_spec
from .requirements import required_catalog
from .storage import StorageUnavailable, _json
from .tools import describe_connection

VOLTAGE_QUERY = """UNWIND $checks AS check
MATCH (p:Pin {id:check.id})
OPTIONAL MATCH (p)-[:ON_NET*2..2]-(peer:Pin)
WHERE peer.id <> p.id
RETURN p.id, collect(DISTINCT CASE WHEN peer.id IN $anchors THEN peer.id ELSE null END)
ORDER BY p.id"""


def voltage_review(store, circuit_id, facts):
    catalog = required_catalog()
    known = {(p['match']['lib'], p['match']['part']): p for p in catalog['parts']}
    components = {c['ref']: c for c in facts['components']}
    pins = {(p['ref'], p['pin']): p for p in facts['pins']}
    anchors = {}
    for pin in facts['pins']:
        board = identify(components[pin['ref']])
        spec, conflict = pin_spec(board, pin) if board else (None, None)
        if spec and not conflict and 'IOREF' not in spec['names']:
            anchors[_json([pin['ref'], pin['pin']])] = (pin, spec, board)
    results, checks, bindings, findings, queries, unknown = [], [], {}, [], [], []
    for ref, component in components.items():
        identity = component['libsource']
        part = known.get((identity['lib'], identity['part']))
        if not part:
            if not identify(component):
                unknown.append(ref)
            continue
        rating = part.get('voltage')
        item = {'ref': ref, 'name': part['name'], 'status': 'unverified',
                'sources': rating['sources'] if rating else part['sources']}
        results.append(item)
        if not rating:
            item['reason'] = part.get('voltage_unverified', 'No verified operating voltage range for this exact part.')
            continue
        item.update(pin=rating['power_pin'], ground_pin=rating['ground_pin'],
                    operating_range={'min': rating['min'], 'max': rating['max']})
        required = {p['number']: p for p in part['pins']}
        pair = [pins.get((ref, rating[key])) for key in ('power_pin', 'ground_pin')]
        if any(not pin or pin_spec(part, pin) != (required[pin['pin']], None) for pin in pair):
            item['reason'] = 'Power or ground pin metadata is absent or conflicting; voltage cannot be verified.'
            continue
        power, ground = pair
        pid, gid = (_json([p['ref'], p['pin']]) for p in pair)
        checks.extend([{'id': pid}, {'id': gid}])
        bindings[pid] = (item, power, ground, rating)
    if checks:
        parameters = {'checks': checks, 'anchors': list(anchors)}
        try:
            rows = store.db.select_graph(store.graph_name(circuit_id)).ro_query(
                VOLTAGE_QUERY, parameters, timeout=5000).result_set
        except RedisError as exc:
            raise StorageUnavailable('Could not verify supply voltage connections in FalkorDB. Please try again.') from exc
        queries.append({'cypher': VOLTAGE_QUERY, 'parameters': parameters})
        if {row[0] for row in rows} != {check['id'] for check in checks} or len(rows) != len(checks):
            raise StorageUnavailable('Circuit pin data changed during voltage checks. Reload and try again.')
        routes = dict(rows)
        for pid, (item, power, ground, rating) in bindings.items():
            supplies = [anchors[a] for a in routes[pid]]
            returns = [anchors[a] for a in routes[_json([ground['ref'], ground['pin']])]]
            pair = {(power['ref'], power['pin']), (ground['ref'], ground['pin'])}
            nets = [n for n in facts['nets'] if any((p['ref'], p['pin']) in pair for p in n['pins'])]
            item['evidence'] = describe_connection({'selected_pin': power, 'nets': nets})['evidence']
            if not supplies or not returns:
                item['reason'] = 'No direct wire route from both supply pins to known board rails/ground. External supplies and paths through components need verification.'
                continue
            supply_voltages = {s['nominal_voltage'] for _, s, _ in supplies}
            return_voltages = {s['nominal_voltage'] for _, s, _ in returns}
            if len(supply_voltages) != 1 or return_voltages != {0.0}:
                item['reason'] = 'Conflicting rails or an unverified ground reference prevent a reliable supply-voltage comparison.'
                continue
            if not ({p['ref'] for p, _, _ in supplies} & {p['ref'] for p, _, _ in returns}):
                item['reason'] = 'Supply and ground do not reach the same identified board. A shared voltage reference has not been established.'
                continue
            # An additional, unknown source can invalidate a nominal rail assumption.
            if any((p['ref'], p['pin']) not in pair and
                   _json([p['ref'], p['pin']]) not in anchors and
                   any('power_out' in (p.get(k) or '').split('+') for k in ('pintype', 'library_type'))
                   for n in nets for p in n['pins']):
                item['reason'] = 'An additional supply output has no verified voltage specification; check the supply arrangement.'
                continue
            voltage = next(iter(supply_voltages))
            item.update(nominal_voltage=voltage,
                        status='within_range' if rating['min'] <= voltage <= rating['max'] else 'outside_range',
                        supply_pins=[{'ref': p['ref'], 'pin': p['pin'], 'name': p['name']} for p, _, _ in supplies],
                        ground_pins=[{'ref': p['ref'], 'pin': p['pin'], 'name': p['name']} for p, _, _ in returns])
            sources = {s['url']: s for s in rating['sources']}
            sources.update({s['url']: s for _, _, board in supplies + returns for s in board['sources']})
            item['sources'] = list(sources.values())
            if item['status'] == 'outside_range':
                source_labels = ', '.join(f"{p['ref']} pin {p['pin']} ({p['name']})" for p, _, _ in supplies)
                findings.append({'rule': 'supply_voltage_mismatch', 'severity': 'warning',
                    'title': f"{power['ref']}: supply voltage is outside its operating range",
                    'message': f"{power['ref']} pin {power['pin']} ({power['name']}) connects to {source_labels}: {voltage:g}V nominal. Its datasheet operating range is {rating['min']:g}–{rating['max']:g}V. This is a possible supply problem, not a voltage measurement.",
                    'suggestion': f"Check the highlighted supply and ground wires. Use a supply within the exact part's {rating['min']:g}–{rating['max']:g}V operating range, then export and upload again.",
                    'pin': power, 'evidence': item['evidence'], 'sources': item['sources'],
                    'specifications': item})
    return {'findings': findings, 'queries': queries, 'coverage': {
        'catalog_version': catalog['version'], 'verified_on': catalog['verified_on'],
        'checks': results, 'checked_parts': sum(p['status'] != 'unverified' for p in results),
        'unverified_parts': sum(p['status'] == 'unverified' for p in results),
        'unknown_components': unknown,
        'scope': 'Nominal supply only, via direct wires to identified board rails with a common ground reference. Operating range, not absolute maximum. No measured voltage, GPIO or current verification.'}}
