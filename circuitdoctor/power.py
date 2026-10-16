"""Trace direct board power rails without inventing supply dependencies."""
from .parts import identify, pin_spec
from .tools import explain_net


def trace_power(store, circuit_id, **selection):
    connection = explain_net(store, circuit_id, **selection)
    facts = store.review_facts(circuit_id)
    parts = {c['ref']: identify(c) for c in facts['components']}

    def specification(pin):
        part = parts.get(pin['ref'])
        return pin_spec(part, pin)[0] if part else None

    selected = connection['selected_pin']
    if selected:
        spec = specification(selected)
        if not spec or spec['role'] != 'rail':
            raise ValueError('Select an identified Uno R3 or classic Nano power pin, or its net. Ground, signal and unknown pins are not power sources.')
    rails = []
    for pin in ([selected] if selected else []) + [p for n in connection['nets'] for p in n['pins']]:
        spec = specification(pin)
        if spec and spec['role'] == 'rail' and not any(p['ref'] == pin['ref'] and p['pin'] == pin['pin'] for p in rails):
            rails.append({**pin, 'nominal_voltage': spec['nominal_voltage']})
    if not rails:
        raise ValueError('No identified Arduino power rail on this net. Select a net connected to a known 5V, 3.3V or IOREF pin.')
    rail_ids = {(p['ref'], p['pin']) for p in rails}
    connected = [p for n in connection['nets'] for p in n['pins'] if (p['ref'], p['pin']) not in rail_ids]
    connected_parts = sorted({p['ref'] for p in connected})
    rail_labels = ', '.join(f"{p['ref']} pin {p['pin']} ({p['nominal_voltage']:g}V nominal)" for p in rails)
    connections = '; '.join(f"{p['ref']} pin {p['pin']}" for p in connected)
    summary = f"Power rail: {rail_labels}. "
    summary += (f"Directly connected pins: {connections}. " if connected else 'No other pins are connected to this rail in the file. ')
    summary += 'If this rail loses power, parts that rely on it for supply may stop working. Connectivity alone does not establish which parts rely on it.'
    warnings = []
    if any((spec := specification(p)) and spec['role'] == 'ground' for p in connected):
        warnings.append('This rail is directly connected to a known board ground. Run review to inspect the wiring conflict.')
    if len({p['nominal_voltage'] for p in rails}) > 1:
        warnings.append('Different nominal voltage rails share this net. Run review to inspect the wiring conflict.')
    sources = {s['url']: s for p in rails for s in parts[p['ref']]['sources']}
    return {**connection, 'tool': 'trace_power', 'scope': 'direct_board_rail',
            'summary': summary, 'rails': rails, 'connected_parts': connected_parts,
            'connected_pins': connected, 'warnings': warnings, 'sources': list(sources.values()),
            'queries': connection['queries'] + facts['queries'],
            'limitations': [
                'Direct rail connections only. The trace stops at component pins; it does not cross resistors, regulators or shared ground.',
                'Supply direction, alternative power sources and external component requirements are not verified. Connected does not mean powered.',
                'Voltages are board specifications, not measurements. This does not predict current, firmware behavior or hardware failure.',
            ]}
