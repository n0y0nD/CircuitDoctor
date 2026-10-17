"""Derived resistor passages shared by upload and saved-graph migration."""
import json

PATH_MODEL_VERSION = 1
RESISTOR_QUERY = """UNWIND $rows AS r
MATCH (a:Pin {id:r.start}), (b:Pin {id:r.end})
MERGE (a)-[e:THROUGH]->(b)
SET e.ref=r.ref, e.model='two_terminal_resistor_v1'"""


def resistor_rows(components, pin_keys):
    per_component = {}
    for ref, number in pin_keys:
        per_component.setdefault(ref, set()).add(number)
    rows = []
    for component in components:
        source = component['libsource']
        numbers = sorted(per_component.get(component['ref'], []))
        if source in ({'lib': 'Device', 'part': 'R'}, {'lib': 'Device', 'part': 'R_Small'}) and len(numbers) == 2:
            ref = component['ref']
            rows.append({'ref': ref,
                         'start': json.dumps([ref, numbers[0]], ensure_ascii=False),
                         'end': json.dumps([ref, numbers[1]], ensure_ascii=False)})
    return rows
