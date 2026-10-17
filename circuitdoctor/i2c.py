"""Source-backed I2C signal checks on direct FalkorDB wire routes.

Hardware pin correspondence only: no firmware, pull-up or logic-level verdicts.
"""
from redis.exceptions import RedisError

from .parts import identify, pin_spec
from .requirements import required_catalog
from .storage import StorageUnavailable, _json
from .tools import describe_connection

I2C_QUERY = """UNWIND $checks AS check
MATCH (p:Pin {id:check})
OPTIONAL MATCH (p)-[:ON_NET*2..2]-(peer:Pin)
WHERE peer.id <> p.id
RETURN p.id, collect(DISTINCT peer.id)
ORDER BY p.id"""


def signal_spec(specs, pin):
    """Match both the exported symbol pin ID and every available name."""
    for spec in specs:
        if pin['pin'] == spec['number'] and pin_spec({'pins': [spec]}, pin) == (spec, None):
            return spec
    return None


def i2c_review(store, circuit_id, facts):
    catalog = required_catalog()
    known = {(p['match']['lib'], p['match']['part']): p for p in catalog['parts'] if p.get('i2c')}
    components = {c['ref']: c for c in facts['components']}
    pins = {_json([p['ref'], p['pin']]): p for p in facts['pins']}
    board_pins, device_pins = {}, {}
    checks, bindings, results, findings, queries = [], {}, [], [], []
    for pid, pin in pins.items():
        board = identify(components[pin['ref']])
        spec = signal_spec(board.get('i2c', {}).get('pins', []), pin) if board else None
        if spec:
            board_pins[pid] = (pin, spec, board)
    for ref, component in components.items():
        identity = component['libsource']
        part = known.get((identity['lib'], identity['part']))
        if not part:
            continue
        for spec in part['i2c']['pins']:
            pid = _json([ref, spec['number']])
            pin = pins.get(pid)
            item = {'ref': ref, 'pin': spec['number'], 'signal': spec['signal'],
                    'status': 'unverified', 'sources': part['i2c']['sources']}
            results.append(item)
            if not pin or signal_spec(part['i2c']['pins'], pin) != spec:
                item['message'] = f"{ref} {spec['signal']}: pin information is missing or conflicting; wiring was not assessed."
                continue
            checks.append(pid)
            bindings[pid] = (item, pin)
            device_pins[pid] = spec
    joined_nets = set()
    if checks:
        parameters = {'checks': checks}
        try:
            rows = store.db.select_graph(store.graph_name(circuit_id)).ro_query(
                I2C_QUERY, parameters, timeout=5000).result_set
        except RedisError as exc:
            raise StorageUnavailable('Could not check I2C wiring in FalkorDB. Please try again.') from exc
        queries.append({'cypher': I2C_QUERY, 'parameters': parameters})
        if len(rows) != len(checks) or {r[0] for r in rows} != set(checks):
            raise StorageUnavailable('Circuit pins changed during I2C checks. Reload and try again.')
        for pid, peers in rows:
            item, pin = bindings[pid]
            signal = item['signal']
            other = 'SCL' if signal == 'SDA' else 'SDA'
            reached = [board_pins[p] for p in peers if p in board_pins]
            expected = [p for p, s, _ in reached if s['signal'] == signal]
            opposite = [p for p, s, _ in reached if s['signal'] == other]
            crossed_device = [pins[p] for p in peers if p in device_pins and device_pins[p]['signal'] == other]
            nets = [n for n in facts['nets'] if any(p['ref'] == pin['ref'] and p['pin'] == pin['pin'] for p in n['pins'])]
            evidence = describe_connection({'selected_pin': pin, 'nets': nets})['evidence']
            item['evidence'] = evidence
            item['board_pins'] = [{'ref': p['ref'], 'pin': p['pin'], 'signal': s['signal']} for p, s, _ in reached]
            sources = {s['url']: s for s in item['sources']}
            for _, _, board in reached:
                sources.update({s['url']: s for s in board['sources'] + board['i2c']['sources']})
            item['sources'] = list(sources.values())
            label = f"{pin['ref']} pin {pin['pin']} ({signal})"
            rule = None
            if crossed_device or (expected and opposite):
                item['status'] = 'joined'
                rule = 'i2c_lines_joined'
                title = f"{pin['ref']}: SDA and SCL share a wire"
                item['message'] = f"{label} shares a net with both data (SDA) and clock (SCL) connections. These are separate I2C signals; this may prevent communication."
                suggestion = 'Separate SDA and SCL into two nets. Check the highlighted pins, then export and upload again.'
            elif opposite:
                item['status'] = 'mismatch'
                rule = 'i2c_signal_mismatch'
                title = f"{pin['ref']}: {signal} goes to Arduino {other}"
                destinations = ', '.join(f"{p['ref']} pin {p['pin']} ({other})" for p in opposite)
                item['message'] = f"{label} connects to {destinations}. This does not match Arduino hardware I2C wiring and is a possible reason communication may fail."
                suggestion = f'If using hardware I2C, connect {signal} to Arduino {signal}. If using software I2C, check the pins configured in your code first.'
            elif expected:
                item['status'] = 'connected'
                destinations = ', '.join(f"{p['ref']} pin {p['pin']} ({signal})" for p in expected)
                item['message'] = f"{label} → {destinations}. Hardware I2C pin matches."
            elif not peers:
                item['status'] = 'unconnected'
                rule = 'i2c_signal_unconnected'
                title = f"{pin['ref']}: {signal} wire is missing"
                item['message'] = f"{label} has no connection to another pin in this file. This part requires {signal} for I2C communication."
                suggestion = f'Connect {signal} to the controller pin used by your I2C code, then export and upload again.'
            else:
                item['message'] = f"{label} is wired, but its route to a verified Arduino hardware {signal} pin was not established. Check your software-I2C settings or any intermediate parts."
            if rule == 'i2c_lines_joined':
                net_ids = frozenset(n['code'] for n in nets)
                if net_ids in joined_nets:
                    continue
                joined_nets.add(net_ids)
            if rule:
                findings.append({'rule': rule, 'severity': 'warning', 'title': title,
                                 'message': item['message'], 'suggestion': suggestion,
                                 'pin': pin, 'evidence': evidence, 'sources': item['sources']})
    return {'findings': findings, 'queries': queries, 'coverage': {
        'checks': results, 'checked_pins': len(checks),
        'unverified_pins': sum(p['status'] == 'unverified' for p in results),
        'scope': 'Exact catalog parts and consistent symbol pin IDs/names; direct wires to Uno R3/classic Nano hardware I2C. Software I2C, pull-ups, logic levels, addresses and communication are not verified.'}}
