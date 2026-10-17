"""Source-backed, conservative wiring review without LLM verdicts."""

from .isolation import isolated_groups
from .i2c import i2c_review
from .parts import electrical_review
from .requirements import required_connections
from .voltage import voltage_review
from .tools import _known, _marked_unused, _pin_label, describe_connection


def check_rules(store, circuit_id):
    facts = store.review_facts(circuit_id)
    isolation = isolated_groups(store, circuit_id, facts)
    required = required_connections(store, circuit_id, facts)
    voltage = voltage_review(store, circuit_id, facts)
    i2c = i2c_review(store, circuit_id, facts)
    required_missing = {(f['pin']['ref'], f['pin']['pin']) for f in required['findings'] + i2c['findings']}
    findings = []
    unused = sum(_marked_unused(pin) for pin in facts["pins"])

    def add(rule, severity, title, message, suggestion, *, net=None, pin=None):
        selection = {"net_code": net["code"]} if net is not None else {"ref": pin["ref"], "pin": pin["pin"]}
        evidence = describe_connection({"selected_pin": pin, "nets": [net] if net is not None else []})["evidence"]
        findings.append({"id": f"finding-{len(findings) + 1}", "rule": rule,
                         "severity": severity, "title": title, "message": message,
                         "suggestion": suggestion, "selection": selection, "evidence": evidence})

    for net in facts["nets"]:
        members = net["pins"]
        if len(members) == 1 and not _marked_unused(members[0]) and (members[0]["ref"], members[0]["pin"]) not in required_missing:
            add("single_pin_net", "info", "Pin has no connection",
                f'{_pin_label(members[0])} is not connected to another pin in this file.',
                "Check whether your design needs this pin. An unconnected pin may be intentional; the file alone does not tell us whether it is a problem.", net=net)
        elif not members:
            add("empty_net", "info", "Net has no pin connections",
                f'Net {net["name"]!r} has no pin memberships in the saved graph.',
                "Check the source schematic and export again if this net should contain connections.", net=net)

    for pin in facts["unassigned_pins"]:
        if not _marked_unused(pin) and (pin["ref"], pin["pin"]) not in required_missing:
            add("unassigned_pin", "info", "Pin connection cannot be verified",
                f'{_pin_label(pin)} exists in the saved graph but has no net membership.',
                "Check the schematic if this pin is needed. The export alone does not tell us whether it should be connected; this is not a confirmed wiring fault.", pin=pin)

    electrical = electrical_review(facts)
    for item in electrical["findings"]:
        add(item["rule"], "warning", item["title"], item["message"], item["suggestion"], net=item["net"])
        findings[-1].update(sources=item["sources"], specifications=item["specifications"])

    for item in required['findings']:
        add(item['rule'], item['severity'], item['title'], item['message'], item['suggestion'], pin=item['pin'])
        findings[-1].update(evidence=item['evidence'], sources=item['sources'])

    for item in i2c['findings']:
        add(item['rule'], item['severity'], item['title'], item['message'], item['suggestion'], pin=item['pin'])
        findings[-1].update(evidence=item['evidence'], sources=item['sources'])

    for item in voltage['findings']:
        add(item['rule'], item['severity'], item['title'], item['message'], item['suggestion'], pin=item['pin'])
        findings[-1].update(evidence=item['evidence'], sources=item['sources'], specifications=item['specifications'])

    for item in isolation["findings"]:
        findings.append({"id": f"finding-{len(findings) + 1}", **item})

    warning_count = sum(item["severity"] == "warning" for item in findings)
    empty = not facts["component_count"] or not facts["nets"]
    unknown_names = sum(not _known(pin["name"]) and not _known(pin["pinfunction"]) for pin in facts["pins"])
    unknown_types = sum(not _known(pin["library_type"]) and not _known(pin["pintype"]) for pin in facts["pins"])
    cannot_verify = [
        {"check": "Full voltage compatibility", "reason": "Only catalog-listed operating ranges and direct nominal board supply connections are compared. Unknown part variants, external supplies, paths through components, GPIO limits, VIN and actual voltages are not verified."},
        {"check": "Other required connections", "reason": "Only catalog-listed logic power/GND pins are checked. I2C signal correspondence is checked only for exact catalog parts and identified board pins. Other parts, software I2C, backlights and pull-ups are not verified."},
        {"check": "Circuit operation", "reason": "Firmware, current, physical wiring and component health are not checked."},
    ]
    if electrical["coverage"]["conflicting_pin_metadata"]:
        cannot_verify.insert(0, {"check": "Conflicting pin metadata", "reason": "Some library pin names conflict with exported pin functions. Those pins were excluded from electrical checks."})
    if empty:
        cannot_verify.insert(0, {"check": "Complete connectivity review", "reason": "This export has no components or no nets to review."})
    return {"tool": "check_rules", "source": "falkordb", "circuit_id": circuit_id,
            "scope": "connectivity_and_board_rails", "electrical": electrical["coverage"], "requirements": required["coverage"], "isolation": isolation["coverage"], "voltage": voltage["coverage"], "i2c": i2c["coverage"], "status": "incomplete" if empty else "warnings" if warning_count else "no_warnings",
            "summary": {"components": facts["component_count"], "nets": len(facts["nets"]),
                        "pins": len(facts["pins"]), "warnings": warning_count,
                        "information": len(findings) - warning_count, "marked_unused_pins": unused,
                        "unknown_pin_names": unknown_names, "unknown_pin_types": unknown_types},
            "findings": findings, "cannot_verify": cannot_verify, "queries": facts["queries"] + isolation["queries"] + required["queries"] + voltage["queries"] + i2c["queries"],
            "limitations": ["Connectivity, limited board rails, catalog-listed supply pins, verified nominal supply ranges and hardware I2C pin correspondence only. No warnings does not mean the circuit is electrically correct.",
                            "Unused markers are read from pin metadata, not inferred from net names."]}
