"""Structural component groups computed by FalkorDB, not electrical paths.

HAS_PIN joins a part's terminals for grouping only. Never use these groups as
proof of conduction, signal reachability, grounding or power dependency.
"""
from redis.exceptions import RedisError
from .parts import identify
from .storage import StorageUnavailable
from .tools import describe_connection, _identifier

WCC_QUERY = """CALL algo.WCC({nodeLabels:['Component','Pin','Net'],
  relationshipTypes:['HAS_PIN','ON_NET']}) YIELD node, componentId
WITH node, componentId WHERE 'Component' IN labels(node)
RETURN componentId, collect(node.ref)"""


def isolated_groups(store, circuit_id, facts):
    graph = store.db.select_graph(store.graph_name(circuit_id))
    try:
        rows = graph.ro_query(WCC_QUERY, timeout=5000).result_set
    except RedisError as exc:
        raise StorageUnavailable('Could not check disconnected groups in FalkorDB. Please try again.') from exc
    components = {c['ref']: c for c in facts['components']}
    groups = sorted((sorted(refs) for _, refs in rows), key=lambda refs: tuple(refs))
    returned = [ref for refs in groups for ref in refs]
    if len(returned) != len(components) or set(returned) != set(components):
        raise StorageUnavailable('Circuit data changed while checking groups. Reload and try again.')
    board_refs = {ref for ref, c in components.items() if identify(c)}
    findings, coverage = [], []
    for index, refs in enumerate(groups):
        group_boards = sorted(board_refs.intersection(refs))
        coverage.append({'id': f'group-{index + 1}', 'components': refs, 'board_refs': group_boards})
        # Without an identified board, report separate groups neutrally; don't
        # choose the largest group as the presumed main circuit.
        if (board_refs and group_boards) or (not board_refs and len(groups) < 2):
            continue
        nets = [net for net in facts['nets'] if any(p['ref'] in refs for p in net['pins'])]
        evidence = describe_connection({'selected_pin': None, 'nets': nets})['evidence']
        nodes = {n['id']: n for n in evidence['nodes']}
        edges = {e['id']: e for e in evidence['edges']}
        paths = evidence['paths']
        for pin in facts['unassigned_pins']:
            if pin['ref'] in refs:
                extra = describe_connection({'selected_pin': pin, 'nets': []})['evidence']
                nodes.update((n['id'], n) for n in extra['nodes'])
                edges.update((e['id'], e) for e in extra['edges'])
                paths.extend(extra['paths'])
        for ref in refs:
            cid = _identifier('component', ref)
            if cid not in nodes:
                nodes[cid] = {'id': cid, 'kind': 'component', 'ref': ref, 'value': components[ref]['value']}
                paths.append([cid])
        label = ', '.join(refs)
        message = (f"These parts ({label}) have no wiring link to any identified Arduino board in this file."
                   if board_refs else f"{label} forms a separate group from the other parts in this file. No supported Arduino board was identified.")
        findings.append({'rule': 'isolated_group', 'severity': 'info',
                         'title': f'Separate group: {label}',
                         'message': message + ' This may be intentional; it is not a confirmed fault.',
                         'suggestion': 'Check whether this group should connect to the rest of your design. If a wire is missing, correct the schematic and upload it again.',
                         'selection': {'component_refs': refs},
                         'evidence': {'nodes': list(nodes.values()), 'edges': list(edges.values()), 'paths': paths}})
    return {'findings': findings, 'queries': [{'cypher': WCC_QUERY, 'parameters': {}}],
            'coverage': {'algorithm': 'algo.WCC', 'group_count': len(groups), 'groups': coverage,
                         'board_refs': sorted(board_refs), 'separate_groups': len(findings),
                         'scope': 'Structural grouping via component ownership and shared nets, including ground. Not a current-flow or power-dependency analysis.'}}
