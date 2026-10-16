"""Read KiCad S-expression .net exports into a JSON-compatible Python dict.

Connections and pin metadata are taken from the file, without board-specific
pin guesses. Missing pinfunction/pintype values remain "unknown". Library pin
definitions are retained separately; they are not substituted for node metadata.
"""

from pathlib import Path
from typing import Any

from sexpdata import ExpectClosingBracket, ExpectNothing, ExpectSExp, Parser, Symbol

MAX_FILE_BYTES = 10 * 1024 * 1024


class NetlistParseError(ValueError):
    """The input cannot be read as an unambiguous KiCad connectivity netlist."""


class _NetlistSexpParser(Parser):
    def atom(self, token):
        # Pins and net codes are identifiers, not numbers. Preserve 01, 1.0,
        # alphanumeric pins and atoms named t/nil instead of Lisp conversions.
        return Symbol(token)


def _tag(form, name):
    return isinstance(form, list) and bool(form) and form[0] == Symbol(name)


def _children(form, name):
    return [item for item in form[1:] if _tag(item, name)]


def _one(form, name, *, required=False):
    matches = _children(form, name)
    if len(matches) > 1:
        raise NetlistParseError(f"Duplicate '{name}' field in '{form[0]}'.")
    if not matches:
        if required:
            raise NetlistParseError(f"Missing '{name}' field in '{form[0]}'.")
        return [Symbol(name)]
    return matches[0]


def _atom(value, context):
    if isinstance(value, Symbol):
        return value.value()
    if isinstance(value, str):
        return value
    raise NetlistParseError(f"Expected text for {context}.")


def _text(form, name, *, default="", required=False):
    field = _one(form, name, required=required)
    if len(field) == 1 and not required:
        return default
    if len(field) != 2:
        raise NetlistParseError(f"Expected one value for '{name}' in '{form[0]}'.")
    value = _atom(field[1], name)
    if required and not value.strip():
        raise NetlistParseError(f"Empty '{name}' in '{form[0]}'.")
    return value


def _records(section, name):
    for record in section[1:]:
        if not _tag(record, name):
            raise NetlistParseError(f"Expected '{name}' entries in '{section[0]}'.")
        yield record


def _unique(mapping, key, value, context):
    if key in mapping:
        raise NetlistParseError(f"Duplicate {context}: {key!r}.")
    mapping[key] = value


def _fields(component):
    result = {}
    for field in _records(_one(component, "fields"), "field"):
        name = _text(field, "name", required=True)
        # KiCad writes (field (name "Manufacturer") "value"), including empty
        # fields with no final string. Keep Unicode, spaces and escaped quotes.
        values = [item for item in field[1:] if not _tag(item, "name")]
        if len(values) > 1:
            raise NetlistParseError(f"Multiple values for component field {name!r}.")
        value = _atom(values[0], name) if values else ""
        _unique(result, name, value, "component field")
    return result


def parse_netlist(text: str) -> dict[str, Any]:
    """Parse one UTF-8 KiCad S-expression export; raise NetlistParseError on error.

    The result contains version, design metadata, components, libparts and nets.
    All identifiers remain strings. No database writes or electrical checks run.
    """
    if not isinstance(text, str):
        raise NetlistParseError("Netlist input must be text.")
    try:
        size = len(text.encode("utf-8"))
    except UnicodeEncodeError as exc:
        raise NetlistParseError("Netlist must contain valid UTF-8 text.") from exc
    if size > MAX_FILE_BYTES:
        raise NetlistParseError("Netlist exceeds the 10 MiB input limit.")
    text = text.removeprefix("\ufeff")
    if not text.strip():
        raise NetlistParseError("The netlist is empty.")
    if text.lstrip().startswith("<"):
        raise NetlistParseError("XML is not supported here. Export a KiCad S-expression .net file.")
    try:
        forms = _NetlistSexpParser(text).parse()
    except (ExpectClosingBracket, ExpectNothing, ExpectSExp, IndexError,
            AttributeError, ValueError, RecursionError) as exc:
        raise NetlistParseError("Invalid or incomplete S-expression; check quotes and parentheses.") from exc
    if len(forms) != 1 or not _tag(forms[0], "export"):
        raise NetlistParseError("Expected one KiCad (export ...) netlist, not a schematic or PCB file.")
    root = forms[0]
    components = {}
    for comp in _records(_one(root, "components", required=True), "comp"):
        ref = _text(comp, "ref", required=True)
        libsource = _one(comp, "libsource")
        sheetpath = _one(comp, "sheetpath")
        properties = {}
        for prop in _children(comp, "property"):
            _unique(properties, _text(prop, "name", required=True),
                    _text(prop, "value"), "component property")
        _unique(components, ref, {
            "ref": ref,
            "value": _text(comp, "value", default="unknown"),
            "footprint": _text(comp, "footprint"),
            "datasheet": _text(comp, "datasheet"),
            "libsource": {key: _text(libsource, key) for key in ("lib", "part")},
            "sheetpath": {key: _text(sheetpath, key) for key in ("names", "tstamps")},
            "fields": _fields(comp),
            "properties": properties,
        }, "component reference")

    libparts = {}
    for part in _records(_one(root, "libparts"), "libpart"):
        lib, name = _text(part, "lib"), _text(part, "part", required=True)
        pins = {}
        for pin in _records(_one(part, "pins"), "pin"):
            number = _text(pin, "num", required=True)
            _unique(pins, number, {
                "num": number,
                "name": _text(pin, "name", default="unknown"),
                "type": _text(pin, "type", default="unknown"),
            }, f"library pin in {lib}:{name}")
        _unique(libparts, (lib, name), {
            "lib": lib, "part": name,
            "description": _text(part, "description"),
            "datasheet": _text(part, "docs"),
            "pins": list(pins.values()),
        }, "library part")

    nets, net_names, pin_nets = {}, set(), {}
    for net in _records(_one(root, "nets", required=True), "net"):
        code, name = _text(net, "code", required=True), _text(net, "name", required=True)
        if name in net_names:
            raise NetlistParseError(f"Duplicate net name: {name!r}.")
        net_names.add(name)
        nodes = []
        for node in _children(net, "node"):
            ref, pin = _text(node, "ref", required=True), _text(node, "pin", required=True)
            if ref not in components:
                raise NetlistParseError(f"Net {name!r} refers to unknown component {ref!r}.")
            _unique(pin_nets, (ref, pin), code, "pin connection (a pin may belong to only one net)")
            nodes.append({
                "ref": ref, "pin": pin,
                "pinfunction": _text(node, "pinfunction", default="unknown"),
                "pintype": _text(node, "pintype", default="unknown"),
            })
        if not nodes:
            raise NetlistParseError(f"Net {name!r} has no nodes.")
        _unique(nets, code, {"code": code, "name": name, "nodes": nodes}, "net code")

    design = _one(root, "design")
    return {
        "version": _text(root, "version", default="unknown"),
        "design": {key: _text(design, key) for key in ("source", "date", "tool")},
        "components": list(components.values()),
        "libparts": list(libparts.values()),
        "nets": list(nets.values()),
    }


def load_netlist(path: str | Path) -> dict[str, Any]:
    """Read a bounded UTF-8 file. Filesystem errors remain OSError subclasses."""
    with Path(path).open("rb") as file:
        raw = file.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES:
        raise NetlistParseError("Netlist exceeds the 10 MiB input limit.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise NetlistParseError("Netlist must be UTF-8 encoded.") from exc
    return parse_netlist(text)
