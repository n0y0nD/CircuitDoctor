#!/usr/bin/env python3
"""Verify Part 2 fixtures using KiCad's exporter and ERC (standard library only).

This is fixture QA, not the Part 3 .net parser or the future rule engine.
The checked-in .net files are compared to independent, fresh KiCad exports;
XML exports provide the connectivity oracle without implementing a .net parser.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / 'samples'
SOURCE = SAMPLES / 'source'


def normalize_netlist(text):
    """Ignore only exporter timestamps, source paths and library URI locations."""
    text = re.sub(r'\(date "[^"]*"\)', '(date "EXPORT_DATE")', text)
    for tag in ('source', 'uri'):
        text = re.sub(r'\(' + tag + r' "([^"]*)"\)',
                      lambda m: f'({tag} "{m[1].replace(chr(92), "/").rsplit("/", 1)[-1]}")', text)
    return text


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kicad-cli', default=os.environ.get('KICAD_CLI', 'kicad-cli'))
    args = parser.parse_args()
    cli = shutil.which(args.kicad_cli)
    if cli is None:
        parser.error('KiCad CLI is required; pass --kicad-cli /path/to/kicad-cli')
    expected = json.loads((SAMPLES / 'expected.json').read_text())
    maps, net_types, component_records = {}, {}, {}

    with tempfile.TemporaryDirectory(prefix='circuitdoctor-fixtures-') as tmp:
        tmp = Path(tmp)
        version = subprocess.check_output([cli, '--version'], text=True, timeout=30).strip()
        # Keep library loading bounded and never modify the user's KiCad settings.
        config = tmp / 'config' / '.'.join(version.split('.')[:2])
        config.mkdir(parents=True)
        table = (SOURCE / 'sym-lib-table').read_text().replace('${KIPRJMOD}', SOURCE.as_posix())
        (config / 'sym-lib-table').write_text(table)
        (config / 'fp-lib-table').write_text('(fp_lib_table (version 7))\n')
        env = dict(os.environ, KICAD_CONFIG_HOME=str(tmp / 'config'))

        def run(*options):
            result = subprocess.run([cli, *options], env=env, cwd=ROOT,
                                    capture_output=True, text=True, timeout=120)
            if result.returncode:
                raise RuntimeError(f'KiCad failed ({result.returncode}): {result.stdout}\n{result.stderr}')

        for name in ('clean', 'voltage_mismatch'):
            schematic = SOURCE / f'{name}.kicad_sch'
            native, xml, erc = (tmp / f'{name}{suffix}' for suffix in ('.net', '.xml', '.erc.json'))
            run('sch', 'export', 'netlist', '--output', str(native), str(schematic))
            require(normalize_netlist(native.read_text()) ==
                    normalize_netlist((SAMPLES / f'{name}.net').read_text()),
                    f'{name}: committed .net differs from its KiCad schematic export')
            run('sch', 'export', 'netlist', '--format', 'kicadxml', '--output', str(xml), str(schematic))
            root = ET.parse(xml).getroot()
            components = root.findall('./components/comp')
            values = {c.attrib['ref']: c.findtext('value') for c in components}
            require(len(components) == len(values) == 14, f'{name}: missing or duplicate components')
            require(values == expected['components'], f'{name}: wrong component values')
            # The two sources have different filenames; that provenance is not
            # a component change. Keep all other component metadata in the comparison.
            records = copy.deepcopy(components)
            for component in records:
                for field in component.findall('./property[@name="Sheetfile"]'):
                    component.remove(field)
            component_records[name] = [ET.tostring(c) for c in records]
            maps[name], net_types[name], connected = {}, {}, {}
            nets = root.findall('./nets/net')
            require(len(nets) == expected['expected_total_net_count'], f'{name}: unexpected net count')
            require(len({n.attrib['name'] for n in nets}) == len(nets), f'{name}: duplicate net names')
            for net in nets:
                netname = net.attrib['name']
                nodes = net.findall('node')
                for pin in nodes:
                    key = f'{pin.attrib["ref"]}:{pin.attrib["pin"]}'
                    require(pin.attrib['ref'] in values, f'{name}: unknown component {key}')
                    require(key not in maps[name], f'{name}: pin assigned more than once: {key}')
                    maps[name][key] = netname
                    net_types[name][key] = dict(pin.attrib)
                if len(nodes) > 1:
                    connected[netname] = {f'{p.attrib["ref"]}:{p.attrib["pin"]}' for p in nodes}
                else:
                    require(len(nodes) == 1 and 'no_connect' in nodes[0].attrib['pintype'],
                            f'{name}: unexpected floating pin on {netname}')

            wanted = copy.deepcopy(expected['clean_connections'])
            if name == 'voltage_mismatch':
                wanted['/+3V3'].remove('U1:2')
                wanted['/+5V'].append('U1:2')
            require(connected == {net: set(pins) for net, pins in wanted.items()},
                    f'{name}: connectivity does not match the independent fixture oracle')
            require(len(maps[name]) == expected['expected_total_pin_count'], f'{name}: pin count differs')
            required_pins = ({f'U1:{n}' for n in range(1, 40)} |
                             {f'J1:{n}' for n in ('1','2','3','4','5','SH')} |
                             {f'U2:{n}' for n in ('VCC','GND','SDA','SCL')} |
                             {f'U3:{n}' for n in ('1','2','3')} |
                             {f'{ref}:{pin}' for ref in values if ref[0] in 'RC' for pin in ('1','2')})
            require(set(maps[name]) == required_pins, f'{name}: wrong pin inventory')
            # Independent datasheet pin checks, not pin-number guesses from GPIO names.
            for part, number, function in [('ESP32-WROOM-32E','2','VDD'),
                                           ('ESP32-WROOM-32E','33','IO21'),
                                           ('ESP32-WROOM-32E','36','IO22'),
                                           ('TLV1117LV33','1','GND'),
                                           ('TLV1117LV33','2','OUT'),
                                           ('TLV1117LV33','3','IN')]:
                pin = root.find(f'./libparts/libpart[@part="{part}"]/pins/pin[@num="{number}"]')
                require(pin is not None and pin.attrib['name'] == function,
                        f'{name}: wrong library pin mapping {part}:{number}')
            supply = expected['declared_fixture_supplies_v'][maps[name]['U1:2']]
            limits = expected['esp32_supply_limit_v']
            require((limits['min_operating'] <= supply <= limits['max_operating']) == (name == 'clean'),
                    f'{name}: supply fixture expectation is not satisfied')
            run('sch', 'erc', '--format', 'json', '--output', str(erc), str(schematic))
            violations = [v for s in json.loads(erc.read_text())['sheets'] for v in s['violations']]
            require(not violations, f'{name}: ERC violations: {violations}')
            print(f'PASS {name}: 14 parts, 7 connected nets, 33 intentional unused nets, 72 pins; native export matches; ERC clean.', flush=True)

    changes = {pin: (net, maps['voltage_mismatch'].get(pin))
               for pin, net in maps['clean'].items() if net != maps['voltage_mismatch'].get(pin)}
    require(changes == {'U1:2': ('/+3V3', '/+5V')}, f'Unexpected fixture differences: {changes}')
    require(net_types['clean'] == net_types['voltage_mismatch'], 'Pin metadata differs between samples')
    require(component_records['clean'] == component_records['voltage_mismatch'], 'Component records differ')
    print('PASS single intentional change: U1 pin 2, /+3V3 -> /+5V. All other pin connections and component metadata identical (excluding source filename).')
    print('Fixture verification complete. This does not run the future CircuitDoctor review engine.')


if __name__ == '__main__':
    main()
