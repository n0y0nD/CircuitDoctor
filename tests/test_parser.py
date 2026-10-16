"""Parser checks, including real KiCad exports and small format-only fixtures."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from circuitdoctor import NetlistParseError, load_netlist, parse_netlist

ROOT = Path(__file__).resolve().parents[1]

# Format-only Nano fixture, not a hardware design or a diagnostic claim.
# Nano v3.x names/numbers checked against KiCad 10.0.7's MCU_Module symbol:
# D5=8; GND=4,29. Different refs, pins and nets prevent dependence on the Uno LED.
NANO = '''(export (version E)
  (components
    (comp (ref CTRL7) (value Arduino_Nano_v3.x)
      (libsource (lib MCU_Module) (part Arduino_Nano_v3.x)))
    (comp (ref J20) (value CustomConnector)))
  (libparts (libpart (lib MCU_Module) (part Arduino_Nano_v3.x)
    (pins (pin (num 8) (name D5) (type bidirectional))
          (pin (num 4) (name GND) (type power_in))
          (pin (num 29) (name GND) (type power_in)))))
  (nets
    (net (code 001) (name "/controller/pulse")
      (node (ref CTRL7) (pin 8) (pinfunction D5_8) (pintype bidirectional))
      (node (ref J20) (pin 01) (pintype passive)))
    (net (code 002) (name "/controller/return")
      (node (ref CTRL7) (pin 4) (pinfunction GND_4) (pintype power_in))
      (node (ref CTRL7) (pin 29) (pinfunction GND_29) (pintype power_in))
      (node (ref J20) (pin B2) (pintype passive)))))'''


def pin_map(circuit):
    return {(node["ref"], node["pin"]): net["name"]
            for net in circuit["nets"] for node in net["nodes"]}


class SampleTests(unittest.TestCase):
    def test_original_uno_export(self):
        circuit = load_netlist(ROOT / "samples/clean.net")
        self.assertEqual({c["ref"]: c["value"] for c in circuit["components"]},
                         {"A1": "Arduino_UNO_R3", "R1": "330", "D1": "Red LED"})
        self.assertEqual(len(circuit["nets"]), 31)
        self.assertEqual(len(pin_map(circuit)), 36)
        connected = {n["name"]: {(p["ref"], p["pin"]) for p in n["nodes"]}
                     for n in circuit["nets"] if len(n["nodes"]) > 1}
        self.assertEqual(connected, {
            "/GND": {("A1", "6"), ("A1", "7"), ("A1", "29"), ("D1", "1")},
            "/LED_CONTROL": {("A1", "28"), ("R1", "1")},
            "/LED_ANODE": {("R1", "2"), ("D1", "2")},
        })
        uno = next(p for p in circuit["libparts"] if p["part"] == "Arduino_UNO_R3")
        self.assertEqual(len(uno["pins"]), 32)
        self.assertEqual(next(p["name"] for p in uno["pins"] if p["num"] == "28"), "D13")
        self.assertEqual(json.loads(json.dumps(circuit)), circuit)

    def test_missing_ground_differs_only_at_led_cathode(self):
        clean = load_netlist(ROOT / "samples/clean.net")
        faulty = load_netlist(ROOT / "samples/missing_ground.net")
        before, after = pin_map(clean), pin_map(faulty)
        self.assertEqual(before.keys(), after.keys())
        self.assertEqual({pin for pin in before if before[pin] != after[pin]}, {("D1", "1")})
        self.assertEqual(len(faulty["nets"]), 32)
        floating = next(n for n in faulty["nets"] if n["name"] == after[("D1", "1")])
        self.assertEqual(len(floating["nodes"]), 1)
        self.assertNotIn("no_connect", floating["nodes"][0]["pintype"])
        intentional = [n for n in faulty["nets"] if len(n["nodes"]) == 1
                       and "no_connect" in n["nodes"][0]["pintype"]]
        self.assertEqual(len(intentional), 28)

    def test_reference_names_are_not_fixed(self):
        text = (ROOT / "samples/clean.net").read_text()
        text = text.replace('(ref "A1")', '(ref "BOARD42")')
        text = text.replace('(ref "R1")', '(ref "R87")')
        text = text.replace('"/LED_CONTROL"', '"/other_sheet/output"')
        circuit = parse_netlist(text)
        self.assertEqual(pin_map(circuit)[("BOARD42", "28")], "/other_sheet/output")
        self.assertEqual(pin_map(circuit)[("R87", "1")], "/other_sheet/output")
        self.assertNotIn("A1", {c["ref"] for c in circuit["components"]})

    def test_nano_uses_exported_pins_without_uno_mapping(self):
        circuit = parse_netlist(NANO)
        self.assertEqual(circuit["components"][0]["libsource"],
                         {"lib": "MCU_Module", "part": "Arduino_Nano_v3.x"})
        self.assertEqual(pin_map(circuit), {
            ("CTRL7", "8"): "/controller/pulse", ("J20", "01"): "/controller/pulse",
            ("CTRL7", "4"): "/controller/return", ("CTRL7", "29"): "/controller/return",
            ("J20", "B2"): "/controller/return",
        })
        self.assertEqual(circuit["nets"][0]["code"], "001")
        self.assertEqual(circuit["libparts"][0]["pins"][0]["name"], "D5")


class FormatTests(unittest.TestCase):
    def test_older_export_without_pin_metadata_or_library(self):
        circuit = parse_netlist('''(export (version D)
          (components (comp (ref X9) (value OtherPart)))
          (nets (net (code 1) (name GND) (node (ref X9) (pin 1)))))''')
        self.assertEqual(circuit["libparts"], [])
        self.assertEqual(circuit["nets"][0]["nodes"][0], {
            "ref": "X9", "pin": "1", "pinfunction": "unknown", "pintype": "unknown"})

    def test_identifiers_unicode_and_escaped_fields_are_preserved(self):
        circuit = parse_netlist(r'''(export (version E)
          (components (comp (ref nil) (value "Résistor 4.7 kΩ")
            (fields (field (name "Maker") "A \"quoted\" part")
                    (field (name "Blank")))
            (property (name "Path") (value "C:\\designs\\board"))))
          (nets (net (code 1e3) (name t) (node (ref nil) (pin +001)))))''')
        self.assertEqual(circuit["components"][0]["value"], "Résistor 4.7 kΩ")
        self.assertEqual(circuit["components"][0]["fields"], {"Maker": 'A "quoted" part', "Blank": ""})
        self.assertEqual(circuit["components"][0]["properties"]["Path"], r"C:\designs\board")
        self.assertEqual(circuit["nets"][0]["code"], "1e3")
        self.assertEqual(circuit["nets"][0]["name"], "t")
        self.assertEqual(circuit["nets"][0]["nodes"][0]["pin"], "+001")

    def test_empty_export_is_valid_but_empty_file_is_not(self):
        self.assertEqual(parse_netlist('(export (components) (nets))')["components"], [])
        with self.assertRaises(NetlistParseError):
            parse_netlist(" \n")

    def test_library_definition_does_not_invent_node_metadata(self):
        circuit = parse_netlist(NANO.replace('(pinfunction D5_8)', ''))
        self.assertEqual(circuit["nets"][0]["nodes"][0]["pinfunction"], "unknown")
        self.assertEqual(circuit["libparts"][0]["pins"][0]["name"], "D5")

    def test_invalid_files_are_rejected(self):
        invalid = [
            '(export', '(export (components) (nets)) trailing',
            '(export (components) (nets)) (export (components) (nets))',
            '(kicad_sch (version 20250114))', '<export version="E"/>',
            '(export (components))', '(export (nets))',
            '(export (components (comp (ref "unfinished))) (nets))',
            '(export (components (comp (ref (nested)))) (nets))',
            '(export (components (comp (ref ""))) (nets))',
            '(export (components (comp (ref A1) (ref A2))) (nets))',
            '(export (components (comp (ref A1)) (comp (ref A1))) (nets))',
            '(export (components stray) (nets))',
            '(export (components) (components) (nets))',
            '(export (components) (nets (net (code 1) (name GND))))',
            '(export (components) (nets (net (code 1) (name GND) (node (ref X1) (pin 1)))))',
            NANO.replace('(pin 8) (pinfunction', '(pin) (pinfunction'),
            NANO.replace('(code 002)', '(code 001)'),
            NANO.replace('"/controller/return"', '"/controller/pulse"'),
            NANO.replace('(ref CTRL7) (pin 4)', '(ref CTRL7) (pin 8)'),
            NANO.replace('(ref CTRL7) (pin 29)', '(ref CTRL7) (pin 4)'),
            NANO.replace('(num 29)', '(num 4)'),
        ]
        for text in invalid:
            with self.subTest(text=text[:90]), self.assertRaises(NetlistParseError):
                parse_netlist(text)

    def test_utf8_bom_and_invalid_encoding(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.net"
            path.write_bytes(b'\xef\xbb\xbf' + NANO.encode())
            self.assertEqual(load_netlist(path), parse_netlist(NANO))
            path.write_bytes(b'\xff\xfe')
            with self.assertRaisesRegex(NetlistParseError, "UTF-8"):
                load_netlist(path)

    def test_input_limits_and_deep_nesting(self):
        with patch("circuitdoctor.parser.MAX_FILE_BYTES", 32):
            with self.assertRaisesRegex(NetlistParseError, "input limit"):
                parse_netlist(NANO)
            with self.assertRaisesRegex(NetlistParseError, "input limit"):
                load_netlist(ROOT / "samples/clean.net")
        with self.assertRaises(NetlistParseError):
            parse_netlist("(" * 2000 + ")" * 2000)


class CommandTests(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, "-m", "circuitdoctor", *map(str, args)],
                              cwd=ROOT, capture_output=True, text=True, timeout=10)

    def test_json_and_human_readable_output(self):
        result = self.run_cli("samples/clean.net", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), load_netlist(ROOT / "samples/clean.net"))
        result = self.run_cli("samples/missing_ground.net")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Components (3)", result.stdout)
        self.assertIn("Nets (32)", result.stdout)
        self.assertIn("D1.1", result.stdout)

    def test_errors_have_nonzero_exit_without_partial_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.net"
            for content in (None, "(export broken"):
                if content is not None:
                    path.write_text(content)
                result = self.run_cli(path, "--json")
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, "")
                self.assertIn("Cannot read netlist:", result.stderr)
                self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
