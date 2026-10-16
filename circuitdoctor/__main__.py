"""Usage: python -m circuitdoctor path/to/circuit.net [--json]."""

import argparse
import json
from pathlib import Path
import sys

from .parser import NetlistParseError, load_netlist


def main(argv=None):
    cli = argparse.ArgumentParser(description="Read components and connections from a KiCad .net file.")
    cli.add_argument("netlist", type=Path, help="KiCad S-expression netlist")
    cli.add_argument("--json", action="store_true", help="print the complete parsed dictionary as JSON")
    args = cli.parse_args(argv)
    try:
        circuit = load_netlist(args.netlist)
    except (OSError, NetlistParseError) as exc:
        print(f"Cannot read netlist: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(circuit, indent=2, ensure_ascii=False))
        return 0

    print(f"Components ({len(circuit['components'])}):")
    for component in circuit["components"]:
        print(f"  {component['ref']}: {component['value']}")
    print(f"\nNets ({len(circuit['nets'])}):")
    for net in circuit["nets"]:
        print(f"  {net['name']} [code {net['code']}]")
        for node in net["nodes"]:
            print(f"    {node['ref']}.{node['pin']}  {node['pinfunction']}  ({node['pintype']})")
    print("\nParsed connections only; no diagnosis or database loading has run.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
