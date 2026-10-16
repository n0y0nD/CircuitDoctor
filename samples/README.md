# ESP32 + OLED sample circuits

Two KiCad S-expression netlists for developing and testing CircuitDoctor:

| File | Expected supply-review result |
| --- | --- |
| `clean.net` | ESP32 supply is on the declared 3.3 V rail; no planted fault. |
| `voltage_mismatch.net` | U1 pin 2 is on the declared 5 V rail, above its 3.6 V operating limit. |

These are connectivity fixtures. "Clean" refers to the documented checks and
assumptions below; it is not a claim of a manufactured or fully validated PCB.
The faulty sample is analysis input, not a circuit to power physically.

## Circuit

```text
J1 USB 5 V power input -> U3 TLV1117LV33 -> +3V3 -> U1 ESP32-WROOM-32E
                                              -> U2 I2C OLED module

U1 GPIO21 (module pin 33) <-> I2C_SDA <-> U2 SDA
U1 GPIO22 (module pin 36)  -> I2C_SCL  -> U2 SCL

R1 and R2: 4.7 kohm pull-ups from SDA/SCL to +3V3
R3: 10 kohm pull-up on ESP32 EN, with C5 = 1 uF to ground
R4: 10 kohm pull-up on ESP32 GPIO0 for normal flash boot
```

There are **14 components**, **7 connected nets**, and **33 intentional unused
singleton nets** (40 total nets, 72 pin memberships). KiCad keeps unused module
and USB pins in the export; do not treat these singleton nets as physical wires
between parts or as automatic floating-pin errors.

| Reference | Part / role |
| --- | --- |
| J1 | Micro-USB connector, power input only |
| U1 | ESP32-WROOM-32E module, not an ESP32 development board |
| U2 | Waveshare 0.91 inch SSD1306 I2C OLED module interface |
| U3 | TI TLV1117LV33DCYR fixed 3.3 V regulator |
| R1, R2 | 4.7 kohm I2C pull-ups |
| R3, R4 | 10 kohm EN / GPIO0 pull-ups |
| C1 | 10 uF regulator input capacitor |
| C2 | 10 uF ceramic regulator output capacitor |
| C3, C4 | 10 uF + 100 nF ESP32 supply decoupling |
| C5 | 1 uF ESP32 EN reset-delay capacitor |
| C6 | 100 nF external OLED supply decoupling |

All sample capacitors are specified as 10 V X7R. Capacitance under bias, placement,
regulator heat dissipation, USB compliance, firmware and physical faults are
outside this fixture's checks. J1 assumes a regulated 5 V USB power adapter with
sufficient current; there is no USB enumeration, data connection or programmer.
The ESP32 is assumed to contain suitable firmware. The OLED module's internal
regulation, reset and display-drive circuit are abstracted behind its interface.
The external pull-ups are present regardless of any module-internal pull-ups;
bus capacitance, timing and effective parallel resistance are not certified here.

## The one intentional change

Only the net assignment of **U1 pin `2`** changes:

```text
clean:             U1:2 -> /+3V3
voltage_mismatch:  U1:2 -> /+5V
```

No component is added, removed or renamed. OLED power, I2C pull-ups, EN/boot
circuits and all other pin-to-net assignments stay identical. There is no
intentional short between the two supply rails.

U1 pin 2 is called **3V3** in the Espressif datasheet and **VDD** in the KiCad
symbol. Its recommended supply range is **3.0–3.6 V**. GPIO21 is **module pin 33**,
and GPIO22 is **module pin 36**: GPIO names are not package pin numbers.

The net voltages in `expected.json` are **declared test-supply assumptions**.
A net name alone does not prove its voltage. The future loader/reviewer must use
source and component metadata to establish that voltage.

## Input-format details

- Standard KiCad S-expression `.net` format, exported by **KiCad 10.0.7**.
- U2 uses logical string pin IDs `VCC`, `GND`, `SDA`, `SCL`. Its custom symbol
  deliberately does not claim a physical header order or assign a PCB footprint.
  Pin IDs must be kept as strings by the future parser.
- The KiCad ESP32 symbol groups its ground pins visually. Export expands them to
  individual pins `1`, `15`, `38`, and exposed pad `39`, all connected to ground.
- This exporter writes functions such as `IO21_33` and `VDD_2` in net-node
  `pinfunction` fields. The library pin definitions retain `IO21` and `VDD`.
- `pintype` includes values such as `bidirectional+no_connect` and `no_connect`.
  They carry intentional non-connection information; preserve it.
- Schematic sources use local labels, so connected net names have a `/` prefix.
- No PCB footprints are assigned to the instances. This sample is not a PCB layout.

## Reproduce and verify

The editable schematics are in `source/`, alongside minimal project files and
local symbol libraries. Open `source/clean.kicad_sch` in KiCad to inspect the
circuit. Same-name labels are electrically connected even without a long wire
drawn across the page.

From the repository root, with KiCad 10.0.7 available:

```bash
python3 scripts/verify_samples.py
```

For the home-folder AppImage installation used during development:

```bash
python3 scripts/verify_samples.py --kicad-cli "$HOME/KiCad/kicad-cli"
```

The verifier uses only Python's standard library and KiCad. It performs fresh
exports, compares them with the committed `.net` files, checks all connected-net
memberships against a manually specified oracle, verifies pin identities and
intentional unused pins, and runs KiCad ERC on both sources. It confirms that
exactly one pin changes nets. Only dates, source paths and library URI locations
are ignored when comparing the native exports. KiCad settings are isolated in a
temporary directory; the user's preferences are not changed.

Both fixtures are expected to pass ordinary KiCad ERC: pin types alone do not
encode the ESP32 voltage limit. The supply fault is the later datasheet-aware
reviewer's job. `expected.json` records expected results for tests; do **not** feed
those results to the application as discovered facts. The Part 3 application
parser and general review engine are not implemented by this verifier.

## Sources and symbol attribution

- [Espressif ESP32-WROOM-32E/32UE datasheet v2.1](https://documentation.espressif.com/esp32-wroom-32e_esp32-wroom-32ue_datasheet_en.html):
  sections 3.2 and 6.2 for pins and operating voltage; section 9 for the EN RC
  recommendation. The datasheet is authoritative over the generic library's
  description text.
- [TI TLV1117LV datasheet, revision C](https://www.ti.com/lit/ds/symlink/tlv1117lv.pdf):
  section 5 for GND=1, OUT=2/tab, IN=3; section 6.3 for input range; section 8.2.2.1
  for ceramic output capacitors. The custom symbol models the **LV** version,
  which has different capacitor requirements from legacy TLV1117 parts.
- [Waveshare 0.91 inch OLED module manual](https://files.waveshare.com/upload/1/10/0.91inch_OLED_Module_User_Manual_EN.pdf):
  the four named interface signals and the documented 3.3 V supply wiring.
- `RF_Module`, `Connector`, and `Device` library subsets are copied unchanged from
  the official KiCad 10.0.7 bundle. They are compiled by the KiCad community and
  retain the license in `source/symbols/LICENSE-KICAD.md`. Upstream:
  [KiCad symbol libraries](https://gitlab.com/kicad/libraries/kicad-symbols).
- `CircuitDoctor.kicad_sym` contains the project's custom regulator and OLED
  interface symbols based on the cited datasheets.
