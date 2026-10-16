"""Deterministic graph tools. No LLM, simulation or electrical verdicts."""

import json


def _identifier(kind, *parts):
    # Match the circuit workspace IDs, keeping pin numbers as exact strings.
    if kind == "pin":
        return "p:" + json.dumps(list(parts), ensure_ascii=False, separators=(",", ":"))
    return ("c:" if kind == "component" else "n:") + parts[0]


def _known(value):
    return bool(value and value != "unknown")


def _pin_label(pin):
    name = next((value for value in (pin["name"], pin["pinfunction"]) if _known(value)), None)
    return f'{pin["ref"]} pin {pin["pin"]}' + (f" ({name})" if name else " (name unknown)")


def _marked_unused(pin):
    return any("no_connect" in (pin[key] or "").split("+") for key in ("pintype", "library_type"))


def explain_net(store, circuit_id, *, net_code=None, net_name=None, ref=None, pin=None):
    """Explain an exact net or a component's exact exported pin ID.

    A pin *name* (e.g. D13) is not assumed to be its netlist ID (e.g. 28).
    Pass one net selector or both ref and pin. Names are not fuzzy-matched.
    """
    has_pin_selector = ref is not None or pin is not None
    if sum((net_code is not None, net_name is not None, has_pin_selector)) != 1:
        raise ValueError("Supply net_code, net_name, or both ref and pin.")
    if has_pin_selector and (ref is None or pin is None):
        raise ValueError("A pin lookup needs both ref and pin.")
    for value in (net_code, net_name, ref, pin):
        if value is not None and (not isinstance(value, str) or not value):
            raise ValueError("Connection identifiers must be nonempty strings.")

    facts = store.connection_facts(circuit_id, net_code=net_code, net_name=net_name, ref=ref, pin=pin)
    nodes, edges, paths, observations, descriptions = {}, {}, [], [], []

    def add_pin(pin):
        component_id = _identifier("component", pin["ref"])
        pin_id = _identifier("pin", pin["ref"], pin["pin"])
        nodes[component_id] = {"id": component_id, "kind": "component", "ref": pin["ref"],
                               "value": pin["component_value"]}
        nodes[pin_id] = {"id": pin_id, "kind": "pin", **pin}
        edge_id = json.dumps(["HAS_PIN", component_id, pin_id], separators=(",", ":"))
        edges[edge_id] = {"id": edge_id, "source": component_id, "target": pin_id, "type": "HAS_PIN"}
        return component_id, pin_id

    for net in facts["nets"]:
        net_id = _identifier("net", net["code"])
        nodes[net_id] = {"id": net_id, "kind": "net", "code": net["code"], "name": net["name"]}
        for pin_data in net["pins"]:
            component_id, pin_id = add_pin(pin_data)
            edge_id = json.dumps(["ON_NET", pin_id, net_id], separators=(",", ":"))
            edges[edge_id] = {"id": edge_id, "source": pin_id, "target": net_id, "type": "ON_NET"}
            paths.append([component_id, pin_id, net_id])
        members = net["pins"]
        net["pin_count"] = len(members)
        net["component_count"] = len({p["ref"] for p in members})
        if not members:
            state = "empty_net"
            description = f'Net {net["name"]!r} has no exported pin memberships.'
        elif all(_marked_unused(p) for p in members):
            state = "marked_unused"
            description = f'Net {net["name"]!r} contains pins explicitly marked unused in the file.'
        elif len(members) == 1:
            state = "single_pin_net"
            description = f'Net {net["name"]!r} contains only {_pin_label(members[0])}. No second pin is present on this net.'
        else:
            state = "connected"
            description = (f'Net {net["name"]!r} contains {len(members)} pins across '
                           f'{net["component_count"]} components: ' + "; ".join(_pin_label(p) for p in members) + ".")
        net["status"] = state
        descriptions.append(description)
        if state != "connected":
            observations.append({"code": state, "net_code": net["code"], "message": description})
        unknown = [_pin_label(p) for p in members if not _known(p["name"]) and not _known(p["pinfunction"])]
        if unknown:
            observations.append({"code": "unknown_pin_names", "net_code": net["code"], "pins": unknown,
                                 "message": "Pin names are missing. No board pin mapping has been assumed."})
    selected_pin = facts["selected_pin"]
    if selected_pin and not facts["nets"]:
        component_id, pin_id = add_pin(selected_pin)
        paths.append([component_id, pin_id])
        descriptions.append(f'{_pin_label(selected_pin)} exists, but has no exported net membership.')
        observations.append({"code": "no_exported_connection", "message": descriptions[-1]})
    return {"tool": "explain_net", **facts, "summary": " ".join(descriptions),
            "observations": observations,
            "evidence": {"nodes": list(nodes.values()), "edges": list(edges.values()), "paths": paths},
            "limitations": ["Connectivity facts only; this is not an electrical diagnosis.",
                            "A missing connection or single-pin net alone does not establish a fault.",
                            "Voltage, current, firmware behavior and component health are not inferred."]}
