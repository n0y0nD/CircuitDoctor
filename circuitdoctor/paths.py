"""Bounded connection routes computed by FalkorDB, never by a Python graph search.

HAS_PIN describes ownership, not an electrical passage. Only explicit two-pin
Device:R/R_Small symbols get a derived THROUGH edge. It describes a possible
connection through that resistor, not a zero-ohm wire or current simulation.
"""
import json

from redis.exceptions import RedisError

from .storage import ConnectionNotFound, StorageUnavailable, _json
from .tools import _identifier, _pin_label
from .path_model import PATH_MODEL_VERSION

MAX_HOPS = 32
PATH_QUERY = f"""MATCH (a:Pin {{id:$start}}),(b:Pin {{id:$end}})
WITH shortestPath((a)-[:ON_NET|THROUGH*0..{MAX_HOPS}]-(b)) AS route
RETURN nodes(route), relationships(route)"""
LIMITATION = ("Follows wires and two-pin Device:R / Device:R_Small resistors only, "
              f"up to {MAX_HOPS} graph steps. Other component internals are not traced. "
              "A route does not prove current flow or that the circuit works.")


def find_path(store, circuit_id, *, from_ref, from_pin, to_ref, to_pin):
    endpoints = (from_ref, from_pin, to_ref, to_pin)
    if any(not isinstance(x, str) or not x or len(x) > 512 for x in endpoints):
        raise ValueError('Choose two component pins using their exact exported IDs.')
    facts = store.review_facts(circuit_id)
    pins = {(p['ref'], p['pin']): p for p in facts['pins']}
    # A pin on several nets still has one identity.
    start, end = (from_ref, from_pin), (to_ref, to_pin)
    if start not in pins or end not in pins:
        raise ConnectionNotFound('One of those pins is not present in this circuit.')
    components = {c['ref']: c for c in facts['components']}
    graph = store.db.select_graph(facts['graph_name'])
    parameters = {'start': _json(list(start)), 'end': _json(list(end))}
    queries = []
    try:
        model = graph.ro_query("MATCH (m:Circuit {id:$id,ready:true}) RETURN m.path_model_version",
                               {'id': circuit_id}, timeout=5000).result_set
        if not model or model[0][0] != PATH_MODEL_VERSION:
            raise StorageUnavailable('Saved connection paths need preparation. Restart the app and try again.')
        rows = graph.ro_query(PATH_QUERY, parameters, timeout=5000).result_set
    except RedisError as exc:
        raise StorageUnavailable('Could not trace the connection in FalkorDB. Please try again.') from exc
    queries.append({'cypher': PATH_QUERY, 'parameters': parameters})
    route_nodes, route_edges = rows[0] if rows else (None, None)
    nodes, edges, steps, route_ids = {}, [], [], []
    db_ids = {}
    for node in route_nodes or []:
        props = node.properties
        if 'Pin' in node.labels:
            ref, number = json.loads(props['id'])
            pin = pins[(ref, number)]
            identity = _identifier('pin', ref, number)
            component_id = _identifier('component', ref)
            nodes[component_id] = {'id': component_id, 'kind': 'component', 'ref': ref, 'value': components[ref]['value']}
            nodes[identity] = {'id': identity, 'kind': 'pin', **pin}
            edges.append({'type': 'HAS_PIN', 'source': component_id, 'target': identity})
            label = _pin_label(pin)
            steps.append({'kind': 'pin', 'ref': ref, 'pin': number, 'label': label})
        else:
            identity = _identifier('net', props['code'])
            nodes[identity] = {'id': identity, 'kind': 'net', 'code': props['code'], 'name': props['name']}
            steps.append({'kind': 'net', 'code': props['code'], 'label': props['name']})
        route_ids.append(identity)
        db_ids[node.id] = identity
    for edge in route_edges or []:
        edges.append({'type': edge.relation, 'source': db_ids[edge.src_node],
                      'target': db_ids[edge.dest_node], **edge.properties})
    found = bool(route_nodes)
    if start == end:
        summary = 'You selected the same pin twice. Choose a different destination to follow a connection.'
    elif found:
        summary = f"A connection route links {_pin_label(pins[start])} to {_pin_label(pins[end])}."
    else:
        summary = 'No route found using wires and supported resistors within the search limit. This does not mean the circuit is faulty.'
    return {'tool': 'find_path', 'source': 'falkordb', 'circuit_id': circuit_id,
            'graph_name': facts['graph_name'], 'status': 'found' if found else 'not_found',
            'scope': 'wires_and_resistors', 'max_hops': MAX_HOPS,
            'from_pin': pins[start], 'to_pin': pins[end], 'summary': summary,
            'steps': steps, 'hops': len(route_edges or []),
            'through_components': list(dict.fromkeys(e.properties['ref'] for e in route_edges or [] if e.relation == 'THROUGH')),
            'evidence': {'nodes': list(nodes.values()), 'edges': edges, 'paths': [route_ids] if found else []},
            'queries': queries, 'limitations': [LIMITATION]}
