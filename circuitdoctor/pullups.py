"""Find external I2C pull-up topology without guessing hidden module circuits."""
import math
import re
from redis.exceptions import RedisError
from .parts import identify, pin_spec
from .storage import StorageUnavailable, _json
from .tools import describe_connection

SOURCE = {'title': 'NXP I2C specification: SDA/SCL and pull-up sizing (sections 3.1.1 and 7.1)',
          'url': 'https://www.nxp.com/docs/en/user-guide/UM10204.pdf'}
PULLUP_QUERY = '''UNWIND $pins AS id
MATCH (p:Pin {id:id})
OPTIONAL MATCH (p)-[:ON_NET]->(sn:Net)<-[:ON_NET]-(a:Pin)<-[:HAS_PIN]-(r:Component)-[:HAS_PIN]->(b:Pin)-[:ON_NET]->(rn:Net)<-[:ON_NET]-(s:Pin)
WHERE r.ref IN $resistors AND a.id <> b.id AND sn.code <> rn.code AND s.id IN $anchors
RETURN p.id, collect(DISTINCT CASE WHEN r.ref IS NOT NULL
       THEN [r.ref, a.id, b.id, s.id, sn.code, rn.code] ELSE null END)
ORDER BY p.id'''


def resistance(value):
    """Read a limited set of explicit resistor values; placeholders stay unknown."""
    value = re.sub(r'\s*(?:ohms?|[ΩΩ])\s*$', '', value.strip(), flags=re.I).strip()
    multiplier = {'': 1, 'R': 1, 'r': 1, 'k': 1000, 'K': 1000, 'M': 1000000}
    match = re.fullmatch(r'(\d+(?:\.\d+)?|\.\d+)\s*([RrkKM]?)', value)
    if match:
        number = float(match[1]) * multiplier[match[2]]
    else:
        match = re.fullmatch(r'(\d*)([RrkKM])(\d+)', value)
        if not match:
            return None
        number = float((match[1] or '0') + '.' + match[3]) * multiplier[match[2]]
    return number if math.isfinite(number) else None


def pullup_review(store, circuit_id, facts, i2c):
    components = {c['ref']: c for c in facts['components']}
    pins = {_json([p['ref'], p['pin']]): p for p in facts['pins']}
    nets = {n['code']: n for n in facts['nets']}
    per_component, anchors = {}, {}
    for pid, pin in pins.items():
        per_component.setdefault(pin['ref'], []).append(pid)
        board = identify(components[pin['ref']])
        spec, conflict = pin_spec(board, pin) if board else (None, None)
        if spec and not conflict and 'IOREF' not in spec['names']:
            anchors[pid] = (pin, spec, board)
    resistors = [ref for ref, c in components.items()
                 if c['libsource']['lib'] == 'Device' and c['libsource']['part'] in ('R', 'R_Small')
                 and len(per_component.get(ref, [])) == 2]
    bindings, checks, queries = {}, [], []
    for signal in i2c['checks']:
        item = {'ref': signal['ref'], 'pin': signal['pin'], 'signal': signal['signal'],
                'status': 'unverified', 'paths': [], 'sources': [SOURCE],
                'message': 'Signal pin information is missing or conflicting; pull-up wiring was not assessed.'}
        checks.append(item)
        if signal.get('evidence'):
            bindings[_json([signal['ref'], signal['pin']])] = (item, signal)
    if bindings:
        parameters = {'pins': list(bindings), 'resistors': resistors, 'anchors': list(anchors)}
        try:
            rows = store.db.select_graph(store.graph_name(circuit_id)).ro_query(
                PULLUP_QUERY, parameters, timeout=5000).result_set
        except RedisError as exc:
            raise StorageUnavailable('Could not inspect I2C pull-up paths in FalkorDB. Please try again.') from exc
        queries.append({'cypher': PULLUP_QUERY, 'parameters': parameters,
                        'purpose': 'Signal wire → one recognized two-pin resistor → identified board rail. HAS_PIN is used only for resistor ownership.'})
        if len(rows) != len(bindings) or {r[0] for r in rows} != set(bindings):
            raise StorageUnavailable('Circuit pins changed during pull-up checks. Reload and try again.')
        for pid, routes in rows:
            item, signal = bindings[pid]
            item['evidence'] = signal['evidence']
            seen, evidence_members = set(), {}
            for ref, near, far, source, signal_net, supply_net in routes:
                key = (ref, near, far, signal_net, supply_net)
                if key in seen:
                    continue
                seen.add(key)
                pin, spec, board = anchors[source]
                net = nets[supply_net]
                # A ground resistor is a pull-down, not a pull-up. Conflicting or
                # additional unknown sources do not establish a pull-up voltage.
                rail_specs = [anchors[_json([p['ref'], p['pin']])][1] for p in net['pins'] if _json([p['ref'], p['pin']]) in anchors]
                voltages = {s['nominal_voltage'] for s in rail_specs}
                if spec['role'] != 'rail' or len(voltages) != 1 or next(iter(voltages)) <= 0:
                    continue
                unknown_source = any(_json([p['ref'], p['pin']]) not in anchors and
                    any('power_out' in (p.get(k) or '').split('+') for k in ('pintype', 'library_type'))
                    for p in net['pins'])
                if unknown_source:
                    continue
                value = components[ref]['value']
                ohms = resistance(value)
                path = {'resistor': ref, 'value': value, 'resistance_ohms': ohms,
                        'supply_ref': pin['ref'], 'supply_pin': pin['pin'],
                        'nominal_voltage': spec['nominal_voltage'],
                        'signal_net': signal_net, 'supply_net': supply_net,
                        'resistor_pins': [pins[near]['pin'], pins[far]['pin']],
                        'status': 'external_path_found' if ohms is not None and ohms > 0 else 'unverified_value'}
                item['paths'].append(path)
                evidence_members.setdefault(signal_net, set()).update((pid, near))
                evidence_members.setdefault(supply_net, set()).update((far, source))
                item['sources'].extend(s for s in board['sources'] if s not in item['sources'])
            if item['paths']:
                route_nets = [{**nets[code], 'pins': [p for p in nets[code]['pins'] if _json([p['ref'], p['pin']]) in members]} for code, members in evidence_members.items()]
                item['evidence'] = describe_connection({'selected_pin': pins[pid], 'nets': route_nets})['evidence']
                if all(p['status'] == 'external_path_found' for p in item['paths']):
                    item['status'] = 'external_path_found'
                    labels = ', '.join(f"{p['resistor']} ({p['value']}) → {p['nominal_voltage']:g}V nominal" for p in item['paths'])
                    item['message'] = f"External pull-up wiring found: {labels}. Resistor sizing and signal-voltage compatibility still need checking."
                else:
                    item['message'] = 'A resistor route to a supply exists, but its value is zero or unreadable. It has not been counted as a verified pull-up path.'
            else:
                item['message'] = 'No external pull-up route to a known supply was found. The module may already include pull-ups; check its datasheet before adding resistors.'
    return {'queries': queries, 'coverage': {
        'checks': checks, 'external_paths': sum(len(p['paths']) for p in checks),
        'scope': 'External wiring only: one Device:R/R_Small with an explicit positive value, between a catalog I2C signal and a known board rail. Onboard/internal pull-ups, resistor sizing, logic-level compatibility and bus operation are not verified. No external route is not a missing-pull-up diagnosis.'}}
