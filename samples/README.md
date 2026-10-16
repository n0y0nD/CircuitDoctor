# Arduino LED blink samples

These samples reuse the existing Arduino LED blink circuit: **3 components**,
with no extra hardware added.

| Reference | Component |
| --- | --- |
| A1 | Arduino Uno R3, powered through its USB cable |
| R1 | 330 ohm resistor |
| D1 | Red LED |

## Two files

- `clean.net`: Arduino D13 -> R1 -> LED anode; LED cathode -> Arduino GND.
- `missing_ground.net`: the same circuit with only the LED cathode-to-GND wire
  removed. The external LED's circuit is incomplete.

The KiCad symbol uses pin **28** for Arduino **D13**. LED pin **2** is the anode
(A), and pin **1** is the cathode (K). Arduino GND pins **6, 7 and 29** are joined.
All other connections and component values are identical between the samples.
Unused Arduino pins are deliberately marked no-connect. The missing LED ground
pin is left floating, without a no-connect marker, so it can be tested as a fault.

Editable KiCad sources are in `source/`. Both `.net` files were exported by
KiCad 10.0.7 and their pin-to-net connections were checked against the original
Arduino example. A netlist describes wiring; blink timing comes from Arduino
firmware. These files are not yet loaded into FalkorDB.

To re-export from the repository root with KiCad CLI installed:

```bash
kicad-cli sch export netlist -o samples/clean.net samples/source/clean.kicad_sch
kicad-cli sch export netlist -o samples/missing_ground.net samples/source/missing_ground.kicad_sch
```

The sources embed the original KiCad Arduino, resistor and LED symbols.
Their library license is retained in `source/LICENSE-KICAD.md`.
