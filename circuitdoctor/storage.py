"""Store independent circuit graphs and reconstruct connectivity with Cypher.

The loader stores imports and derived resistor THROUGH edges before marking them ready.
Reads follow HAS_PIN / ON_NET relationships; they never
return a cached parser result. Library metadata is preserved separately and is
not treated as evidence that a pin is connected.
"""

from functools import lru_cache
import hashlib
import json
import logging
import os
import re
from uuid import uuid4

from falkordb import FalkorDB
from redis.exceptions import RedisError
from redis.backoff import NoBackoff
from redis.retry import Retry

from .path_model import PATH_MODEL_VERSION, RESISTOR_QUERY, resistor_rows

LOG = logging.getLogger(__name__)
PREFIX = "circuitdoctor_"
BATCH_SIZE = 500
READ_CONNECTIONS = """MATCH (c:Component)-[:HAS_PIN]->(p:Pin)-[e:ON_NET]->(n:Net)
RETURN n.code, c.ref, p.number, p.pinfunction, p.pintype
ORDER BY n.position, e.position"""


class StorageUnavailable(RuntimeError):
    """The circuit could not be stored or read completely."""


class CircuitNotFound(LookupError):
    """Unknown circuit ID or an incomplete import."""


@lru_cache(maxsize=1)
def get_store():
    try:
        return CircuitStore(FalkorDB(
            host=os.environ.get("FALKORDB_HOST", "127.0.0.1"),
            port=int(os.environ.get("FALKORDB_PORT", "6379")),
            username=os.environ.get("FALKORDB_USERNAME") or None,
            password=os.environ.get("FALKORDB_PASSWORD") or None,
            socket_connect_timeout=2,
            socket_timeout=15,
            retry=Retry(NoBackoff(), 0),
        ))
    except RedisError as exc:
        raise StorageUnavailable("FalkorDB is unavailable. Start the database and try again.") from exc


def _json(value):
    return json.dumps(value, ensure_ascii=False)


class CircuitStore:
    def __init__(self, db):
        self.db = db

    def available(self):
        try:
            # PING alone could succeed against Redis without the graph module.
            self.db.list_graphs()
            return True
        except RedisError:
            return False

    @staticmethod
    def graph_name(circuit_id):
        if not re.fullmatch(r"[0-9a-f]{32}", circuit_id):
            raise CircuitNotFound(circuit_id)
        return PREFIX + circuit_id

    @staticmethod
    def _write_batches(graph, query, rows):
        for start in range(0, len(rows), BATCH_SIZE):
            graph.query(query, {"rows": rows[start:start + BATCH_SIZE]}, timeout=10000)

    def save(self, circuit, *, filename="circuit.net"):
        circuit_id = uuid4().hex
        graph_name = self.graph_name(circuit_id)
        graph = self.db.select_graph(graph_name)
        components, pins, nets, memberships = [], {}, [], []
        libraries = {(p["lib"], p["part"]): p for p in circuit["libparts"]}

        def ensure_pin(ref, number, definition=None):
            key = (ref, number)
            if key not in pins:
                definition = definition or {}
                pins[key] = {
                    "id": _json([ref, number]), "ref": ref, "number": number,
                    "name": definition.get("name", "unknown"),
                    "type": definition.get("type", "unknown"),
                    "pinfunction": "unknown", "pintype": "unknown",
                }
            return pins[key]

        for position, comp in enumerate(circuit["components"]):
            metadata = {k: v for k, v in comp.items() if k not in ("ref", "value")}
            components.append({"ref": comp["ref"], "value": comp["value"],
                               "position": position, "metadata": _json(metadata)})
            part = libraries.get((comp["libsource"]["lib"], comp["libsource"]["part"]), {})
            for definition in part.get("pins", []):
                ensure_pin(comp["ref"], definition["num"], definition)
        for position, net in enumerate(circuit["nets"]):
            nets.append({"code": net["code"], "name": net["name"], "position": position})
            for pin_position, node in enumerate(net["nodes"]):
                pin = ensure_pin(node["ref"], node["pin"])
                pin.update(pinfunction=node["pinfunction"], pintype=node["pintype"])
                memberships.append({"id": pin["id"], "code": net["code"],
                                    "position": pin_position})

        try:
            graph.query("CREATE (:Circuit {id:$id, version:$version, design:$design, "
                        "libparts:$libparts, filename:$filename, "
                        "fingerprint:$fingerprint, ready:false})", {
                            "id": circuit_id, "version": circuit["version"],
                            "design": _json(circuit["design"]),
                            "libparts": _json(circuit["libparts"]),
                            "filename": filename[:255],
                            "fingerprint": hashlib.sha256(_json(circuit).encode()).hexdigest(),
                        })
            for label, prop in (("Component", "ref"), ("Pin", "id"), ("Net", "code")):
                graph.query(f"CREATE INDEX FOR (n:{label}) ON (n.{prop})")
            self._write_batches(graph, "UNWIND $rows AS r CREATE (:Component "
                                "{ref:r.ref,value:r.value,position:r.position,metadata:r.metadata})", components)
            self._write_batches(graph, "UNWIND $rows AS r CREATE (:Net "
                                "{code:r.code,name:r.name,position:r.position})", nets)
            self._write_batches(graph, "UNWIND $rows AS r MATCH (c:Component {ref:r.ref}) "
                                "CREATE (c)-[:HAS_PIN]->(:Pin {id:r.id,number:r.number, "
                                "name:r.name,type:r.type,pinfunction:r.pinfunction,pintype:r.pintype})",
                                list(pins.values()))
            self._write_batches(graph, "UNWIND $rows AS r MATCH (p:Pin {id:r.id}), (n:Net {code:r.code}) "
                                "CREATE (p)-[:ON_NET {position:r.position}]->(n)", memberships)
            self._write_batches(graph, RESISTOR_QUERY, resistor_rows(circuit['components'], pins))
            # Publish only after both the original wiring and derived paths exist.
            graph.query("MATCH (m:Circuit) SET m.path_model_version=$version, m.ready=true",
                        {"version": PATH_MODEL_VERSION})
        except RedisError as exc:
            # Only this request's UUID graph is eligible for cleanup.
            try:
                graph.delete()
            except RedisError:
                LOG.warning("Could not clean incomplete graph %s", graph_name)
            raise StorageUnavailable("Could not save circuit to FalkorDB. Please try again.") from exc
        return {"circuit_id": circuit_id, "graph_name": graph_name}

    def migrate_path_models(self):
        """Upgrade ready legacy imports at startup, never during a route request.

        Only this application's UUID graphs with matching Circuit metadata qualify.
        MERGE makes interrupted/concurrent upgrades safe to retry; the version is
        set only after every batch succeeds. Original wiring is never modified.
        """
        migrated = 0
        try:
            for name in self.db.list_graphs():
                if not isinstance(name, str) or not re.fullmatch(PREFIX + r"[0-9a-f]{32}", name):
                    continue
                cid = name[len(PREFIX):]
                graph = self.db.select_graph(name)
                rows = graph.ro_query(
                    "MATCH (m:Circuit {id:$id,ready:true}) RETURN m.path_model_version",
                    {"id": cid}, timeout=10000).result_set
                if not rows or rows[0][0] == PATH_MODEL_VERSION:
                    continue
                if rows[0][0] is not None:
                    raise StorageUnavailable("Saved circuit uses an unsupported connection model.")
                facts = self.review_facts(cid)
                links = resistor_rows(facts['components'], ((p['ref'], p['pin']) for p in facts['pins']))
                self._write_batches(graph, RESISTOR_QUERY, links)
                graph.query("MATCH (m:Circuit {id:$id,ready:true}) SET m.path_model_version=$version",
                            {"id": cid, "version": PATH_MODEL_VERSION}, timeout=10000)
                migrated += 1
        except RedisError as exc:
            raise StorageUnavailable("Could not prepare saved connection paths. Restart the app to retry.") from exc
        return migrated

    def read(self, circuit_id):
        name = self.graph_name(circuit_id)
        graph = self.db.select_graph(name)
        try:
            if not self.db.connection.exists(name):
                raise CircuitNotFound(circuit_id)
            rows = graph.ro_query("MATCH (m:Circuit {ready:true}) RETURN "
                                  "m.version,m.design,m.libparts,m.filename").result_set
            if not rows:
                raise CircuitNotFound(circuit_id)
            version, design, libparts, filename = rows[0]
            components = graph.ro_query("MATCH (c:Component) RETURN c.ref,c.value,c.metadata "
                                        "ORDER BY c.position").result_set
            net_rows = graph.ro_query("MATCH (n:Net) RETURN n.code,n.name ORDER BY n.position").result_set
            connections = graph.ro_query(READ_CONNECTIONS).result_set
            pin_count = graph.ro_query("MATCH (p:Pin) RETURN count(p)").result_set[0][0]
        except RedisError as exc:
            raise StorageUnavailable("Could not read circuit from FalkorDB. Please try again.") from exc
        nets = {code: {"code": code, "name": net_name, "nodes": []} for code, net_name in net_rows}
        for code, ref, number, function, pin_type in connections:
            nets[code]["nodes"].append({"ref": ref, "pin": number,
                                        "pinfunction": function, "pintype": pin_type})
        return {
            "version": version, "design": json.loads(design), "libparts": json.loads(libparts),
            "components": [{**json.loads(meta), "ref": ref, "value": value}
                           for ref, value, meta in components],
            "nets": list(nets.values()),
            "storage": {"source": "falkordb", "circuit_id": circuit_id, "graph_name": name,
                        "filename": filename, "pins": pin_count,
                        "connections": len(connections), "query": READ_CONNECTIONS},
        }

    def connection_facts(self, circuit_id, *, net_code=None, net_name=None, ref=None, pin=None):
        """Read only the selected connection, using parameterized graph traversals."""
        graph_name = self.graph_name(circuit_id)
        graph = self.db.select_graph(graph_name)
        queries = []

        def query(cypher, parameters=None):
            parameters = parameters or {}
            queries.append({"cypher": cypher, "parameters": parameters})
            return graph.ro_query(cypher, parameters, timeout=10000).result_set

        def pin_record(row):
            ref, value, number, name, library_type, function, exported_type = row
            return {"ref": ref, "component_value": value, "pin": number,
                    "name": name, "library_type": library_type,
                    "pinfunction": function, "pintype": exported_type}

        try:
            if not self.db.connection.exists(graph_name):
                raise CircuitNotFound(circuit_id)
            if not query("MATCH (m:Circuit {ready:true}) RETURN m.id"):
                raise CircuitNotFound(circuit_id)
            selected_pin = None
            if ref is not None:
                rows = query("MATCH (c:Component {ref:$ref})-[:HAS_PIN]->(p:Pin {number:$pin}) "
                             "RETURN c.ref,c.value,p.number,p.name,p.type,p.pinfunction,p.pintype",
                             {"ref": ref, "pin": pin})
                if not rows:
                    raise ConnectionNotFound("That component/pin is not present in this circuit.")
                selected_pin = pin_record(rows[0])
                net_rows = query("MATCH (c:Component {ref:$ref})-[:HAS_PIN]->(p:Pin {number:$pin})"
                                 "-[:ON_NET]->(n:Net) RETURN n.code,n.name ORDER BY n.position",
                                 {"ref": ref, "pin": pin})
            elif net_code is not None:
                net_rows = query("MATCH (n:Net {code:$code}) RETURN n.code,n.name", {"code": net_code})
            else:
                net_rows = query("MATCH (n:Net {name:$name}) RETURN n.code,n.name ORDER BY n.position",
                                 {"name": net_name})
                if len(net_rows) > 1:
                    raise AmbiguousConnection("Multiple nets have that name. Select a net_code instead.")
            if selected_pin is None and not net_rows:
                raise ConnectionNotFound("That net is not present in this circuit. Use its exact name or code.")
            nets = {code: {"code": code, "name": name, "pins": []} for code, name in net_rows}
            if nets:
                rows = query("MATCH (c:Component)-[:HAS_PIN]->(p:Pin)-[:ON_NET]->(n:Net) "
                             "WHERE n.code IN $codes RETURN n.code,c.ref,c.value,p.number,p.name,"
                             "p.type,p.pinfunction,p.pintype ORDER BY n.position,c.position,p.number",
                             {"codes": list(nets)})
                for code, *record in rows:
                    nets[code]["pins"].append(pin_record(record))
        except RedisError as exc:
            raise StorageUnavailable("Could not query circuit connections from FalkorDB. Please try again.") from exc
        return {"source": "falkordb", "circuit_id": circuit_id, "graph_name": graph_name,
                "selected_pin": selected_pin, "nets": list(nets.values()), "queries": queries}


    def review_facts(self, circuit_id):
        """Read all nets and pin memberships in a fixed number of graph queries."""
        name = self.graph_name(circuit_id)
        graph = self.db.select_graph(name)
        queries = []

        def query(cypher):
            queries.append({"cypher": cypher, "parameters": {}})
            return graph.ro_query(cypher, timeout=10000).result_set

        try:
            if not self.db.connection.exists(name):
                raise CircuitNotFound(circuit_id)
            if not query("MATCH (m:Circuit {ready:true}) RETURN m.id"):
                raise CircuitNotFound(circuit_id)
            component_rows = query("MATCH (c:Component) RETURN c.ref,c.value,c.metadata ORDER BY c.position")
            components = [{**json.loads(meta), "ref": ref, "value": value}
                          for ref, value, meta in component_rows]
            nets = {code: {"code": code, "name": label, "pins": []}
                    for code, label in query("MATCH (n:Net) RETURN n.code,n.name ORDER BY n.position")}
            rows = query("MATCH (c:Component)-[:HAS_PIN]->(p:Pin) "
                         "OPTIONAL MATCH (p)-[:ON_NET]->(n:Net) "
                         "RETURN c.ref,c.value,p.number,p.name,p.type,p.pinfunction,p.pintype,n.code "
                         "ORDER BY c.position,p.number")
        except RedisError as exc:
            raise StorageUnavailable("Could not review connections from FalkorDB. Please try again.") from exc
        pins, unassigned = {}, []
        for ref, value, number, label, library_type, function, exported_type, code in rows:
            record = {"ref": ref, "component_value": value, "pin": number, "name": label,
                      "library_type": library_type, "pinfunction": function, "pintype": exported_type}
            pins[(ref, number)] = record
            if code is None:
                unassigned.append(record)
            else:
                nets[code]["pins"].append(record)
        return {"source": "falkordb", "circuit_id": circuit_id, "graph_name": name,
                "component_count": len(components), "components": components, "nets": list(nets.values()),
                "pins": list(pins.values()), "unassigned_pins": unassigned, "queries": queries}


class ConnectionNotFound(LookupError):
    """The selected component, pin or net does not exist in this circuit."""


class AmbiguousConnection(LookupError):
    """A name identifies more than one net; a code is needed."""
