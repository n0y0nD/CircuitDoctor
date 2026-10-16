"""Small source-backed catalog. Unknown components and ambiguous pins stay unknown."""
from functools import lru_cache
import json
from pathlib import Path


@lru_cache(maxsize=1)
def catalog():
    return json.loads(Path(__file__).with_name('parts.json').read_text())


def identify(component):
    identity = component.get('libsource', {})
    return next((part for part in catalog()['parts'] if
                 identity.get('lib') == part['match']['lib'] and
                 identity.get('part') == part['match']['part']), None)


def pin_spec(part, pin):
    """A function suffix is stripped only when it matches the exact exported pin ID."""
    aliases = {name.upper(): spec for spec in part['pins'] for name in spec['names']}
    def resolve(value):
        if not value or value == 'unknown':
            return None
        suffix = '_' + pin['pin']
        label = value[:-len(suffix)] if value.endswith(suffix) else value
        return aliases.get(label.upper())
    names = [pin.get('name'), pin.get('pinfunction')]
    known = [name for name in names if name and name != 'unknown']
    resolved = [resolve(name) for name in known]
    # Never let a 5V exported function override a conflicting library pin name.
    if any(resolved) and (not all(resolved) or any(spec != resolved[0] for spec in resolved)):
        return None, 'conflicting_pin_metadata'
    return (resolved[0], None) if resolved else (None, None)


def electrical_review(facts):
    recognized, unknown = {}, []
    for component in facts['components']:
        part = identify(component)
        if part:
            recognized[component['ref']] = part
        else:
            unknown.append(component['ref'])
    matched, conflicts = {}, []
    for pin in facts['pins']:
        part = recognized.get(pin['ref'])
        if not part:
            continue
        spec, conflict = pin_spec(part, pin)
        if conflict:
            conflicts.append({'ref': pin['ref'], 'pin': pin['pin']})
        if spec:
            matched[(pin['ref'], pin['pin'])] = spec

    findings = []
    checked_nets = 0
    for net in facts['nets']:
        pins = [(pin, matched[(pin['ref'], pin['pin'])]) for pin in net['pins']
                if (pin['ref'], pin['pin']) in matched]
        if not pins:
            continue
        checked_nets += 1
        rails = [(pin, spec) for pin, spec in pins if spec['role'] == 'rail']
        grounds = [(pin, spec) for pin, spec in pins if spec['role'] == 'ground']
        rules = []
        if rails and grounds:
            rules.append(('power_ground_short', 'Power rail directly connected to ground',
                          'A known board power rail and ground share the same net.',
                          'Separate the power rail from ground in the schematic before powering the circuit. Check the highlighted pins against the board pinout.'))
        if len({spec['nominal_voltage'] for _, spec in rails}) > 1:
            rules.append(('voltage_rail_conflict', 'Different voltage rails connected together',
                          'Known board rails with different nominal voltages share the same net.',
                          'Separate the 5V and 3.3V rails. Use the correct supply rail for each part; do not join these rails directly.'))
        for rule, title, message, suggestion in rules:
            involved = rails + grounds if rule == 'power_ground_short' else rails
            bindings = [{'ref': pin['ref'], 'pin': pin['pin'], 'name': pin['name'],
                         'nominal_voltage': spec['nominal_voltage'], 'role': spec['role'],
                         'part': recognized[pin['ref']]['id']} for pin, spec in involved]
            sources = {source['url']: source for pin, _ in involved for source in recognized[pin['ref']]['sources']}
            labels = ', '.join(f"{p['ref']} pin {p['pin']} ({p['nominal_voltage']:g}V nominal)" for p in bindings)
            findings.append({'rule': rule, 'title': title,
                             'message': f"{message} Net {net['name']!r}: {labels}. This is a design connection, not a voltage measurement.",
                             'suggestion': suggestion, 'net': net, 'specifications': bindings,
                             'sources': list(sources.values())})
    return {'findings': findings, 'coverage': {
        'catalog_version': catalog()['version'], 'verified_on': catalog()['verified_on'],
        'recognized_parts': [{'ref': ref, 'name': part['name'], 'sources': part['sources']} for ref, part in recognized.items()],
        'unknown_components': unknown, 'matched_power_pins': len(matched), 'checked_nets': checked_nets,
        'conflicting_pin_metadata': conflicts,
        'checks': ['Direct power-to-ground connections', 'Direct connections between different nominal voltage rails'],
    }}
