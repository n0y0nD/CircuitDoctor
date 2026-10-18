"""Compare two saved uploads without confusing missing coverage with a repair."""
from .review import check_rules
from .tools import describe_connection

LIMIT = 100


def _key(pin):
    return pin['ref'], pin['pin']


def _definition(pin):
    # Exporters may suffix a function with its own opaque pin ID.
    def label(value):
        value = value or 'unknown'
        suffix = '_' + pin['pin']
        return value[:-len(suffix)] if value.endswith(suffix) else value
    names = tuple(sorted({label(pin.get(k)) for k in ('name', 'pinfunction')} - {'unknown'}))
    types = tuple(sorted({t for k in ('pintype', 'library_type')
                          for t in (pin.get(k) or 'unknown').split('+')} - {'unknown'}))
    return names, types


def _wire_groups(facts):
    return {tuple(sorted({_key(p) for p in n['pins']})): n for n in facts['nets'] if len(n['pins']) > 1}


def _targets(finding):
    selection = finding['selection']
    if 'ref' in selection:
        return {(selection['ref'], selection['pin'])}
    specs = finding.get('specifications', [])
    if isinstance(specs, list) and specs:
        return {(p['ref'], p['pin']) for p in specs}
    return {_key(p) for p in finding['evidence']['nodes'] if p['kind'] == 'pin'}


def _same_issue(old, new):
    if old['rule'] != new['rule']:
        return False
    a, b = _targets(old), _targets(new)
    # A short can involve additional pins after the edit. It is still present.
    if old['rule'] in ('power_ground_short', 'voltage_rail_conflict'):
        return bool(a & b)
    return a == b


def _positive_recheck(finding, review):
    target = _targets(finding)
    rule = finding['rule']
    if rule in ('power_ground_short', 'voltage_rail_conflict'):
        return True  # Same definitions, fresh rail review, and the violation is absent.
    section, field, good = (
        ('requirements', 'pins', 'connected') if rule.startswith('required_') else
        ('i2c', 'checks', 'connected') if rule.startswith('i2c_') else
        ('voltage', 'checks', 'within_range') if rule == 'supply_voltage_mismatch' else
        ('', '', ''))
    checks = review.get(section, {}).get(field, [])
    return bool(target) and all(any((p.get('ref'), p.get('pin')) == key and p['status'] == good
                                    for p in checks) for key in target)


def compare_circuits(store, original_id, corrected_id):
    # Read immutable, separately stored uploads and re-run deterministic graph checks.
    before, after = (store.review_facts(cid) for cid in (original_id, corrected_id))
    old_review, new_review = (check_rules(store, cid) for cid in (original_id, corrected_id))
    old_parts = {c['ref']: c for c in before['components']}
    new_parts = {c['ref']: c for c in after['components']}
    old_pins = {_key(p): p for p in before['pins']}
    new_pins = {_key(p): p for p in after['pins']}
    common = old_parts.keys() & new_parts.keys()
    changed_parts = sorted(ref for ref in common if any(old_parts[ref].get(k) != new_parts[ref].get(k)
                                                        for k in ('libsource', 'value', 'footprint')))
    removed_parts = sorted(old_parts.keys() - new_parts.keys())
    added_parts = sorted(new_parts.keys() - old_parts.keys())
    missing_pins = sorted(old_pins.keys() - new_pins.keys())
    changed_pins = sorted(k for k in old_pins.keys() & new_pins.keys()
                          if _definition(old_pins[k]) != _definition(new_pins[k]))
    # Conservative matching: never guess renamed references, swapped parts or pin maps.
    comparable = not (changed_parts or removed_parts or missing_pins or changed_pins)
    matching_notes = []
    if removed_parts:
        matching_notes.append('Some original components are missing or renamed. Their warnings cannot be confirmed fixed.')
    if changed_parts:
        matching_notes.append('Some component identities or values changed. Confirm the part choices and review their specifications.')
    if missing_pins or changed_pins:
        matching_notes.append('Some original pin definitions are missing or changed. A disappearing warning may reflect lost check coverage.')
    old_groups, new_groups = _wire_groups(before), _wire_groups(after)
    changes = []
    for status, groups, other in [('removed', old_groups, new_groups), ('added', new_groups, old_groups)]:
        for members in sorted(groups.keys() - other.keys()):
            net = groups[members]
            changes.append({'status': status, 'circuit_id': original_id if status == 'removed' else corrected_id,
                            'pins': net['pins'],
                            'evidence': describe_connection({'selected_pin': None, 'nets': [net]})['evidence']})
    old_warnings = [f for f in old_review['findings'] if f['severity'] == 'warning']
    new_warnings = [f for f in new_review['findings'] if f['severity'] == 'warning']
    items, matched = [], set()
    for finding in old_warnings:
        remaining = [i for i, f in enumerate(new_warnings) if _same_issue(finding, f)]
        if remaining:
            matched.update(remaining)
            current = new_warnings[remaining[0]]
            status, reason = 'persists', 'This warning is still present in the corrected upload.'
        else:
            current = None
            resolved = comparable and bool(changes) and new_review['status'] != 'incomplete' and _positive_recheck(finding, new_review)
            status = 'resolved' if resolved else 'unverified'
            reason = ('This specific wiring warning cleared with matching original parts and pin definitions.' if resolved else
                      'The warning is no longer reported, but its fix cannot be verified from the available part, pin or connection evidence.')
        target = _targets(finding)
        target_nets = [n for n in after['nets'] if any(_key(p) in target for p in n['pins'])]
        target_pin = next((new_pins[k] for k in sorted(target) if k in new_pins), None)
        evidence_after = (current['evidence'] if current else
                          describe_connection({'selected_pin': target_pin, 'nets': target_nets})['evidence'])
        items.append({'status': status, 'title': finding['title'], 'rule': finding['rule'], 'reason': reason,
                      'before': finding['evidence'], 'after': evidence_after})
    for i, finding in enumerate(new_warnings):
        if i not in matched:
            items.append({'status': 'new', 'title': finding['title'], 'rule': finding['rule'],
                          'reason': finding['message'], 'before': None, 'after': finding['evidence']})
    counts = {status: sum(i['status'] == status for i in items) for status in ('resolved', 'persists', 'unverified', 'new')}
    if original_id == corrected_id:
        message = 'This is the same saved upload. Upload a corrected file to compare changes.'
    elif counts['new']:
        message = f"The updated file has {counts['new']} new wiring warning(s). {counts['persists']} earlier warning(s) remain; {counts['resolved']} cleared; {counts['unverified']} could not be verified fixed."
    elif not old_warnings:
        message = 'The original had no supported warnings to verify. Connection changes are shown below.'
    elif counts['unverified']:
        message = 'Some fixes could not be verified. Review the changed parts, pin information and connections.'
    elif counts['persists'] or counts['new']:
        message = 'The corrected upload still has warnings to check.'
    else:
        message = 'The original supported warnings cleared in this upload.'
    return {'tool': 'verify_fix', 'source': 'falkordb', 'original_id': original_id, 'corrected_id': corrected_id,
            'summary': {**counts, 'original_warnings': len(old_warnings), 'corrected_warnings': len(new_warnings),
                        'added_connections': sum(c['status'] == 'added' for c in changes),
                        'removed_connections': sum(c['status'] == 'removed' for c in changes)},
            'message': message, 'matching': {'comparable': comparable, 'notes': matching_notes,
                'added_components': added_parts, 'removed_components': removed_parts, 'changed_components': changed_parts},
            'warnings': items[:LIMIT], 'connections': changes[:LIMIT],
            'truncated': len(items) > LIMIT or len(changes) > LIMIT,
            'limitations': ['Matches component references and exported pin IDs. Renamed references are not guessed.',
                            'Only supported warnings are verified. This does not confirm circuit operation.'],
            'queries': {'original': old_review['queries'], 'corrected': new_review['queries']}}
