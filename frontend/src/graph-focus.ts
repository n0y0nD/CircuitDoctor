import type { Circuit, Selection } from './types.ts';

export const graphPinId = (ref: string, pin: string) => `p:${JSON.stringify([ref, pin])}`;

/** Only explicit net memberships count. Sharing a component never joins its pins. */
export function connectionFocus(circuit: Circuit, selection: Selection) {
  const nets = circuit.nets.filter(net => selection.kind === 'net'
    ? net.code === selection.id
    : net.nodes.some(pin => selection.kind === 'component'
      ? pin.ref === selection.id
      : selection.kind === 'pin' && pin.ref === selection.ref && pin.pin === selection.pin));
  const pins = new Set(nets.flatMap(net => net.nodes.map(pin => graphPinId(pin.ref, pin.pin))));
  const refs = new Set(nets.flatMap(net => net.nodes.map(pin => pin.ref)));
  if (selection.kind === 'component') refs.add(selection.id);
  if (selection.kind === 'pin') { refs.add(selection.ref); pins.add(selection.id); }
  return { nets: new Set(nets.map(net => net.code)), pins, refs };
}
