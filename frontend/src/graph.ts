import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { componentKind, displayValue, visibleNets, netLabel, pinName, type Circuit, type Selection } from './types';
import { circuitArt } from './circuit-art';
import { boardDrawing } from './board-art';
import { partDrawing, groundImage, isGroundNet } from './part-art';
import { evidenceMemberships, type Explanation } from './explanation';
import { simpleWireRoute } from './wire-routing';
import { placeParts } from './graph-layout';
import { connectionFocus } from './graph-focus';
import { probesSvg, type ProbeEnd } from './probes';

/** What the probes touch: two pin ids (red first) and numbered markers for other problems. */
export interface ProbeTargets { red?: string; black?: string; tags?: { id: string; text: string; tone: 'red' | 'ink' }[]; markers?: { n: number; ids: string[] }[] }

type Point = { x: number; y: number };
// Keep manual arrangements while switching tabs, scoped to each uploaded circuit.
const arrangements = new Map<string, Map<string, Point>>();

const pinId = (ref: string, pin: string) => `p:${JSON.stringify([ref,pin])}`;

export class CircuitGraph {
  private cy: Core;
  private observer: ResizeObserver;
  private initial = new Map<string, Point>();
  private arrangement: Map<string, Point>;
  private focusStatus: HTMLElement;
  private overlay: SVGSVGElement;
  private probes: ProbeTargets | null = null;
  private userViewport = false;
  constructor(container: HTMLElement, private circuit: Circuit, showUnused: boolean,
    onSelect: (selection: Selection) => void, onZoom: (value: number) => void, selection: Selection | null = null) {
    const key = circuit.storage.circuit_id;
    this.arrangement = arrangements.get(key) || new Map();
    arrangements.set(key, this.arrangement);
    if (arrangements.size > 20) arrangements.delete(arrangements.keys().next().value!);
    const nets = visibleNets(circuit, showUnused, selection);
    const root = circuit.components.find(c => componentKind(c) === 'board') || circuit.components[0];
    const ground = (net: Circuit['nets'][number]) => isGroundNet(circuit, net);
    // Connectivity determines placement; shared ground does not flatten every component into one column.
    const levels = new Map<string,number>();
    if(root) levels.set(root.ref,0);
    for(let pass=0;pass<circuit.components.length;pass++) {
      let changed = false;
      for(const net of nets.filter(n=>!ground(n))) {
        const known = net.nodes.map(p=>levels.get(p.ref)).filter((v):v is number=>v!==undefined);
        if(!known.length) continue;
        const next = Math.min(...known)+1;
        for(const pin of net.nodes) if(!levels.has(pin.ref)) {levels.set(pin.ref,next);changed=true;}
      }
      if(!changed) break;
    }
    const drawings = new Map(circuit.components.map(c=> {
      const shownPins = new Set(nets.flatMap(n=>n.nodes.filter(p=>p.ref===c.ref).map(p=>p.pin)));
      if(selection?.kind==='pin' && selection.ref===c.ref) shownPins.add(selection.pin);
      return [c.ref,componentKind(c)==='board'?boardDrawing(circuit,c,showUnused?undefined:shownPins):partDrawing(circuit,c)] as const;
    }).filter((entry): entry is readonly [string, ReturnType<typeof boardDrawing>] => entry[1] !== null));
    const positions = placeParts(circuit.components.map(component => {
      const pins = nets.flatMap(n => n.nodes.filter(p => p.ref === component.ref));
      const drawing = drawings.get(component.ref);
      return { ref: component.ref, level: levels.get(component.ref) ?? 1,
        width: drawing?.width ?? 180, height: drawing?.height ?? Math.max(140, Math.ceil(pins.length / 2) * 28 + 55) };
    }));
    const elements: ElementDefinition[] = [];
    const portSides = new Map<string, number>();
    const verticalPorts = new Map<string, number>();
    const ports = new Map<string,{x:number;y:number}>();
    for(const component of circuit.components) {
      const pos = positions.get(component.ref)!;
      const board = componentKind(component)==='board';
      const pins = nets.flatMap(net=>net.nodes.filter(p=>p.ref===component.ref).map(pin=>({pin,net})));
      const sides = {left:[] as typeof pins,right:[] as typeof pins};
      pins.forEach((entry,index)=>{
        const neighborX = entry.net.nodes.filter(p=>p.ref!==component.ref).map(p=>positions.get(p.ref)!.x);
        const left = neighborX.length && neighborX.reduce((a,b)=>a+b,0)/neighborX.length < pos.x;
        if(!board && pins.length===2) {
          // Two-terminal parts need distinct physical terminals even when both neighbors are on one side.
          const incoming = pins.findIndex(p=>!ground(p.net) && p.net.nodes.some(n=>n.ref!==component.ref && positions.get(n.ref)!.x<pos.x));
          const firstSignal = pins.findIndex(p=>!ground(p.net));
          const leftIndex = incoming>=0 ? incoming : Math.max(0,firstSignal);
          sides[index===leftIndex?'left':'right'].push(entry);
        } else sides[left?'left':'right'].push(entry);
      });
      elements.push({data:{id:`c:${component.ref}`,kind:'component',ref:component.ref,
        image:drawings.get(component.ref)?.image || circuitArt(component,pos.height),width:pos.width,height:pos.height,
        label:`${component.ref} · ${displayValue(component)}`,search:`${component.ref} ${component.value}`.toLowerCase()},position:pos});
      for(const [side,entries] of Object.entries(sides)) entries.forEach(({pin,net},index)=>{
        const socket = drawings.get(component.ref)?.ports.get(pin.pin);
        const x = socket ? pos.x-pos.width/2+socket.x : pos.x+(side==='left'?-1:1)*(pos.width/2+25);
        const y = socket ? pos.y-pos.height/2+socket.y : pins.length>2 ? pos.y+(index-(entries.length-1)/2)*24 : pos.y;
        const id = pinId(pin.ref,pin.pin);
        ports.set(id,{x,y});
        portSides.set(id,(socket?.side || side)==='left' ? -1 : 1);
        if(socket?.side==='top' || socket?.side==='bottom') verticalPorts.set(id,socket.side==='top'?-1:1);
        const name = pinName(circuit,pin);
        elements.push({data:{id,kind:'pin',ref:pin.ref,pin:pin.pin,code:net.code,
          label:socket?'':name===`Pin ${pin.pin}`?name:`${pin.pin} · ${name}`,board:board?'yes':'no',
          search:`${pin.ref} ${pin.pin} ${name}`.toLowerCase()},position:{x,y}});
        if (socket) return; // The wire starts on the illustrated terminal itself.
        // Short leads attach each exported pin to its own component. They are not electrical shorts.
        const anchor = `a:${id}`;
        elements.push({data:{id:anchor,kind:'anchor',ref:pin.ref,search:''},position:{x:pos.x+(side==='left'?-1:1)*pos.width/2,y}});
        elements.push({data:{id:`lead:${id}`,source:anchor,target:id,kind:'lead',ref:pin.ref,pinId:id,color:'#8b9b9d'}});
      });
    }
    // A missing-connection finding has no ON_NET edge. Still show its exact
    // selected terminal, without inventing a wire or exposing every unused pin.
    if (selection?.kind === 'pin' && !ports.has(selection.id)) {
      const component = circuit.components.find(part => part.ref === selection.ref);
      const library = circuit.libparts.find(part => part.lib === component?.libsource.lib && part.part === component?.libsource.part);
      const pin = library?.pins.find(pin => pin.num === selection.pin);
      const pos = positions.get(selection.ref);
      if (component && pin && pos) {
        const socket = drawings.get(selection.ref)?.ports.get(selection.pin);
        const x = socket ? pos.x-pos.width/2+socket.x : pos.x+pos.width/2+25;
        const y = socket ? pos.y-pos.height/2+socket.y : pos.y;
        elements.push({data:{id:selection.id,kind:'pin',ref:selection.ref,pin:selection.pin,
          label:`${pin.num} · ${pin.name} (unconnected)`,search:`${selection.ref} ${pin.num} ${pin.name}`.toLowerCase()},position:{x,y}});
      }
    }
    const bottom = Math.max(0,...Array.from(positions.values()).map(p=>p.y+p.height/2))+85;
    nets.forEach((net,index)=>{
      // A one-pin net is not a connection to ground (or any other part).
      // Its terminal is already present above; do not draw a misleading wire.
      if(net.nodes.length<2) return;
      // Muted jumper-wire colours; red is reserved for faults.
      const color = ground(net) ? '#8E9BA6' : ['#B59A6A','#7E8FB0','#8C8AA8','#8E9BA6','#9A8F7E','#7F9A97'][index%6];
      if(net.nodes.length===2) {
        const terminals=net.nodes.map(pin=>{
          const id=pinId(pin.ref,pin.pin), point=ports.get(id)!;
          const vertical=verticalPorts.get(id);
          const side=vertical===-1?'top':vertical===1?'bottom':portSides.get(id)===-1?'left':'right';
          return {...point,side,box:positions.get(pin.ref)!} as const;
        });
        const route=simpleWireRoute(terminals[0],terminals[1],[...positions.values()],index);
        if(route) {
          // Split one continuous route at its midpoint to retain exact per-pin evidence.
          const length=route.slice(1).reduce((sum,p,i)=>sum+Math.abs(p.x-route[i].x)+Math.abs(p.y-route[i].y),0);
          let traversed=0,split=0,mid=route[0];
          for(let i=0;i<route.length-1;i++) {
            const a=route[i],b=route[i+1],distance=Math.abs(b.x-a.x)+Math.abs(b.y-a.y);
            if(traversed+distance>=length/2) {
              const fraction=distance?(length/2-traversed)/distance:0;
              mid={x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction};split=i;break;
            }
            traversed+=distance;
          }
          const netId=`n:${net.code}`;
          elements.push({data:{id:netId,kind:'net',code:net.code,label:netLabel(net),color,search:net.name.toLowerCase()},position:mid});
          const branches=[route.slice(0,split+1),route.slice(split+1).reverse()];
          branches.forEach((branch,branchIndex)=>{
            const pin=net.nodes[branchIndex],source=pinId(pin.ref,pin.pin), key=JSON.stringify([net.code,pin.ref,pin.pin]);
            let previous=source;
            branch.slice(1).forEach((point,i)=>{
              if(point.x===mid.x && point.y===mid.y) return;
              const id=`bend:${key}:${i}`;
              elements.push({data:{id,kind:'bend',ref:pin.ref,code:net.code,color,search:net.name.toLowerCase()},position:point});
              elements.push({data:{id:`e:${key}:${i}`,source:previous,target:id,kind:'wire',code:net.code,ref:pin.ref,pinId:source,color}});
              previous=id;
            });
            elements.push({data:{id:`e:${key}:end`,source:previous,target:netId,kind:'wire',code:net.code,ref:pin.ref,pinId:source,color}});
          });
          return;
        }
      }
      const points = net.nodes.map(p=>ports.get(pinId(p.ref,p.pin))!).filter(Boolean);
      let x = points.reduce((sum,p)=>sum+p.x,0)/Math.max(points.length,1);
      // A terminal pointing away from its peers routes around the part, not through its drawing.
      const wrapsPart = net.nodes.some(pin=>{
        const point = ports.get(pinId(pin.ref,pin.pin))!;
        const side = portSides.get(pinId(pin.ref,pin.pin))!;
        return net.nodes.some(other=>other.ref!==pin.ref && (ports.get(pinId(other.ref,other.pin))!.x-point.x)*side<0);
      });
      const top = Math.min(...net.nodes.map(pin=>{const pos=positions.get(pin.ref)!;return pos.y-pos.height/2;}));
      const rightExits = net.nodes.filter(p=>portSides.get(pinId(p.ref,p.pin))===1).map(p=>positions.get(p.ref)!).map(p=>p.x+p.width/2+35);
      const leftExits = net.nodes.filter(p=>portSides.get(pinId(p.ref,p.pin))===-1).map(p=>positions.get(p.ref)!).map(p=>p.x-p.width/2-35);
      const columns = [...new Set(net.nodes.map(p=>positions.get(p.ref)!.x))].sort((a,b)=>a-b);
      const low = columns.length>1 ? Math.max(...net.nodes.filter(p=>positions.get(p.ref)!.x===columns[0]).map(p=>{const part=positions.get(p.ref)!;return part.x+part.width/2+35;})) : Math.max(...rightExits);
      const high = columns.length>1 ? Math.min(...net.nodes.filter(p=>positions.get(p.ref)!.x===columns[1]).map(p=>{const part=positions.get(p.ref)!;return part.x-part.width/2-35;})) : Math.min(...leftExits);
      const sharedTrunk = columns.length>1 && high>low;
      if(sharedTrunk) x = low+(high-low)*(0.2+0.6*((index%7)/6));
      else if(net.nodes.some(p=>verticalPorts.has(pinId(p.ref,p.pin))))
        x=Math.max(...net.nodes.map(p=>{const part=positions.get(p.ref)!;return part.x+part.width/2;}))+55+(index%7)*19;
      const y = sharedTrunk ? points.reduce((sum,p)=>sum+p.y,0)/points.length : ground(net) ? bottom+index*16 : wrapsPart ? top-55-index*26 : points.reduce((sum,p)=>sum+p.y,0)/Math.max(points.length,1)-55-(index%3)*23;
      elements.push({data:{id:`n:${net.code}`,kind:'net',code:net.code,label:netLabel(net),
        single:net.nodes.length===1?'yes':'no',ground:ground(net)&&!sharedTrunk?'yes':'no',image:ground(net)?groundImage:'',color,search:net.name.toLowerCase()},position:{x,y}});
      net.nodes.forEach((pin,pinIndex)=>{
        const source = pinId(pin.ref,pin.pin);
        const point = ports.get(source)!;
        const side = portSides.get(source)!;
        const key = JSON.stringify([net.code,pin.ref,pin.pin]);
        const exit = `exit:${key}`, bend = `bend:${key}`;
        const part = positions.get(pin.ref)!;
        const vertical = verticalPorts.get(source);
        const needsDetour = !vertical && sharedTrunk && (x-point.x)*side<0;
        const outside = sharedTrunk && !needsDetour ? x : part.x+side*(part.width/2+40+(index%7)*12+pinIndex*10);
        // First leave the socket sideways. The open circle is a freely movable wire bend.
        elements.push({data:{id:exit,kind:'anchor',ref:pin.ref,code:net.code,search:''},position:vertical?{x:point.x,y:part.y+vertical*(part.height/2+32+(index%7)*19)}:{x:outside,y:point.y}});
        const detourY = vertical ? part.y+vertical*(part.height/2+32+(index%7)*19) : needsDetour ? part.y+part.height/2+30+(index%5)*12 : y;
        elements.push({data:{id:bend,kind:'bend',ref:pin.ref,code:net.code,color,search:net.name.toLowerCase()},position:{x:vertical?x:outside,y:detourY}});
        const segments = [[source,exit],[exit,bend]];
        if(needsDetour) {
          const join = `join:${key}`;
          elements.push({data:{id:join,kind:'bend',ref:pin.ref,code:net.code,color,search:net.name.toLowerCase()},position:{x,y:detourY}});
          segments.push([bend,join],[join,`n:${net.code}`]);
        } else segments.push([bend,`n:${net.code}`]);
        segments.forEach(([from,to],segment)=>elements.push({
          data:{id:`e:${key}:${segment}`,source:from,target:to,kind:'wire',code:net.code,ref:pin.ref,pinId:source,color}}));
      });
    });
    this.cy = cytoscape({container,elements,layout:{name:'preset'},minZoom:0.06,maxZoom:3,
      boxSelectionEnabled:false,autounselectify:true,autoungrabify:false,
      style:[
        {selector:'node[kind = "component"]',style:{shape:'round-rectangle',width:'data(width)',height:'data(height)',
          'background-image':'data(image)','background-fit':'contain','background-opacity':0,'border-width':0,
          label:'data(label)','font-family':'"Bricolage Grotesque Variable", "Bricolage Grotesque", sans-serif','font-size':18,'font-weight':700,color:'#1D1C1A','text-valign':'top','text-margin-y':-24,
          'text-max-width':'280px','text-wrap':'wrap','overlay-opacity':0,'bounds-expansion':6}},
        {selector:'node[kind = "pin"]',style:{width:8,height:8,'background-color':'#f5d580','border-width':1.5,'border-color':'#7b6a3e',
          label:'data(label)','font-family':'"JetBrains Mono Variable", "JetBrains Mono", monospace','font-size':11,color:'#55524C','text-valign':'top','text-margin-y':-7,'text-background-color':'#EFECE5',
          'text-background-opacity':0.94,'text-background-padding':'2px','overlay-opacity':0,'z-index':10}},
        {selector:'node[board = "yes"]',style:{width:9,height:9,'background-color':'#eabf57','border-color':'#fff0af','border-width':1.5}},
        {selector:'node[kind = "bend"]',style:{width:10,height:10,'background-color':'#F6F4EF','border-color':'#55524C','border-width':1.5,'overlay-opacity':0,'z-index':10,opacity:0}},
        {selector:'node[kind = "anchor"]',style:{width:1,height:1,opacity:0,events:'no'}},
        {selector:'node[kind = "net"]',style:{width:6,height:6,'background-color':'data(color)',label:'',
          'font-family':'"JetBrains Mono Variable", "JetBrains Mono", monospace','font-size':12,color:'#55524C','text-valign':'top','text-margin-y':-8,'text-background-color':'#EFECE5',
          'text-background-opacity':1,'text-background-padding':'4px','overlay-opacity':0}},
        {selector:'node[ground = "yes"]',style:{width:32,height:28,'background-image':'data(image)','background-fit':'contain','background-opacity':0,'border-width':0}},
        {selector:'node[single = "yes"]',style:{'background-color':'#EFECE5','border-width':1.5,'border-color':'#8A867E'}},
        {selector:'edge',style:{width:2.5,'line-color':'data(color)','curve-style':'taxi','taxi-direction':'auto','taxi-turn':'50%','taxi-turn-min-distance':0,'source-endpoint':'outside-to-node','target-endpoint':'outside-to-node','overlay-opacity':0}},
        {selector:'edge[kind = "lead"]',style:{'curve-style':'straight',width:2}},
        {selector:'.active',style:{'border-width':2,'border-color':'#1D1C1A'}},
        {selector:'node[kind = "component"].active',style:{'border-width':0}},
        {selector:'.selection-muted',style:{opacity:0.22}},
        {selector:'node.connected',style:{'border-color':'#1D1C1A','border-width':2}},
        {selector:'node[kind = "component"].connected',style:{'border-width':0}},
        {selector:'edge.connected',style:{width:3,'line-color':'#1D1C1A','z-index':5}},
        {selector:'node[kind = "bend"].connected',style:{opacity:1}},
        {selector:'node[kind = "net"].active',style:{label:'data(label)'}},
        {selector:'.muted',style:{opacity:0.18}},
        {selector:'.evidence-muted',style:{opacity:0.22}},
        // A traced route is dark ink; red is only for faults.
        {selector:'node.evidence',style:{'border-width':2.5,'border-color':'#1D1C1A',opacity:1}},
        {selector:'node[kind = "component"].evidence',style:{'border-width':0}},
        {selector:'node[kind = "net"].evidence',style:{'background-color':'#1D1C1A',width:8,height:8}},
        {selector:'edge.evidence',style:{width:3.5,'line-color':'#1D1C1A',opacity:1,'z-index':6}},
        // The faulty net: red, under a soft halo, with junction dots.
        {selector:'node.issue',style:{'border-color':'#D4362A'}},
        {selector:'node[kind = "component"].issue',style:{'border-width':0}},
        {selector:'node[kind = "pin"].issue',style:{width:10,height:10,'background-color':'#f5d580','border-width':2.5,'border-color':'#D4362A'}},
        {selector:'node[kind = "net"].issue',style:{'background-color':'#D4362A',width:9,height:9,'border-width':0}},
        {selector:'edge.issue',style:{width:3,'line-color':'#D4362A','underlay-color':'#D4362A','underlay-opacity':0.13,'underlay-padding':6,'z-index':7}},
        // Wires that changed between two uploads are green.
        {selector:'node[kind = "pin"].change',style:{'border-color':'#2F7D4C','border-width':2.5}},
        {selector:'node[kind = "net"].change',style:{'background-color':'#2F7D4C'}},
        {selector:'edge.change',style:{'line-color':'#2F7D4C',width:3.5}},
        {selector:'node.tagged',style:{label:'data(tag)','font-family':'"JetBrains Mono Variable", "JetBrains Mono", monospace','font-size':12,'font-weight':600,color:'#1D1C1A',
          'text-background-color':'#F6F4EF','text-background-opacity':1,'text-background-padding':'3px','text-background-shape':'roundrectangle','text-margin-y':-12,'z-index':12}},
        {selector:'node.tagged.tag-red',style:{color:'#ffffff','text-background-color':'#D4362A'}},
        {selector:'.match',style:{'border-width':2.5,'border-color':'#1D1C1A',opacity:1}},
        {selector:'node[kind = "component"].match',style:{'border-width':0}},
      ]});
    this.cy.nodes().forEach(node => { this.initial.set(node.id(), { ...node.position() }); });
    this.cy.nodes('[kind = "pin"], [kind = "anchor"]').ungrabify();
    // Terminals are rigidly attached to the component; moving a part never changes a net.
    this.cy.on('position', 'node[kind = "component"]', event => {
      const node = event.target;
      const original = this.initial.get(node.id())!;
      const position = node.position();
      const delta = { x: position.x - original.x, y: position.y - original.y };
      this.cy.batch(() => {
        this.cy.nodes().filter(pin => pin.data('ref') === node.data('ref') &&
          (pin.data('kind') === 'pin' || pin.data('kind') === 'anchor')).forEach(pin => {
          const start = this.initial.get(pin.id())!;
          pin.position({ x: start.x + delta.x, y: start.y + delta.y });
        });
      });
    });
    this.cy.batch(() => {
      this.arrangement.forEach((position, id) => this.cy.getElementById(id).position(position));
    });
    this.cy.on('grab', 'node[kind = "component"], node[kind = "net"], node[kind = "bend"]', () => {
      container.style.cursor = 'grabbing';
    });
    this.cy.on('free', 'node[kind = "component"], node[kind = "net"], node[kind = "bend"]', event => {
      this.arrangement.set(event.target.id(), { ...event.target.position() });
      container.style.cursor = 'grab';
    });
    this.cy.on('tap','node',event=>{
      const d=event.target.data();
      if(d.kind==='anchor') return;
      onSelect(d.kind==='component'?{kind:'component',id:d.ref}:d.kind==='pin'?{kind:'pin',id:d.id,ref:d.ref,pin:d.pin}:{kind:'net',id:d.code});
    });
    this.cy.on('dbltap','node[kind = "component"]',event=>{this.userViewport=true;this.cy.fit(event.target,30);});
    this.cy.on('tap','edge[kind = "wire"]',event=>onSelect({kind:'net',id:event.target.data('code')}));
    this.focusStatus = document.createElement('div');
    this.focusStatus.className = 'canvas-focus';
    this.focusStatus.hidden = true;
    this.focusStatus.setAttribute('role','status');
    container.parentElement!.append(this.focusStatus);
    this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.overlay.setAttribute('class', 'probe-overlay');
    this.overlay.setAttribute('aria-hidden', 'true');
    container.parentElement!.append(this.overlay);
    this.cy.on('render', () => this.drawProbes());
    this.cy.on('mouseover','node, edge[kind = "wire"]',()=>{container.style.cursor='grab';});
    this.cy.on('mouseout','node, edge',()=>{container.style.cursor='grab';});
    this.cy.on('dragpan scrollzoom pinchzoom', () => { this.userViewport = true; });
    this.cy.on('zoom',()=>onZoom(Math.round(this.cy.zoom()*100)));
    let size = { width: container.clientWidth, height: container.clientHeight };
    this.observer = new ResizeObserver(() => {
      const next = { width: container.clientWidth, height: container.clientHeight };
      if (next.width === size.width && next.height === size.height) return;
      if (!this.userViewport) { size = next; this.fit(); return; }
      // Resize without discarding the user's zoom or the point they were looking at.
      const pan = this.cy.pan();
      this.cy.resize();
      this.cy.pan({ x: pan.x + (next.width - size.width) / 2, y: pan.y + (next.height - size.height) / 2 });
      size = next;
    });
    this.observer.observe(container);
    this.fit();
  }
  select(selection:Selection|null) {
    if(selection) this.setProbes(null);
    this.cy.elements().removeClass('active connected selection-muted');
    this.focusStatus.hidden = !selection;
    if(!selection)return;
    const focus = connectionFocus(this.circuit,selection);
    this.cy.elements().addClass('selection-muted');
    this.cy.nodes().filter(n=>n.data('kind')==='component' ? focus.refs.has(n.data('ref')) : focus.pins.has(n.id()) || focus.nets.has(n.data('code'))).removeClass('selection-muted').addClass('connected');
    this.cy.edges().filter(e=>focus.pins.has(e.data('pinId'))).removeClass('selection-muted').addClass('connected');
    this.cy.getElementById(selection.kind==='pin' ? selection.id : `${selection.kind==='component'?'c':'n'}:${selection.id}`).addClass('active');
    this.setFocusLabel(selection.kind==='component' ? `${selection.id} · Connected parts and wires` : selection.kind==='pin' ? `${selection.ref} · Pin ${selection.pin}` : 'Selected connection');
  }
  private setFocusLabel(label: string) {
    this.focusStatus.hidden = false;
    this.focusStatus.replaceChildren(document.createTextNode(label));
    const clear = document.createElement('button');
    clear.type = 'button'; clear.textContent = 'Show all';
    clear.onclick = () => this.clearFocus();
    this.focusStatus.append(clear);
  }
  /** Put the probes on two pins (red first). Pins not drawn in this view are simply skipped. */
  setProbes(targets: ProbeTargets | null) {
    this.probes = targets;
    this.cy.nodes('.tagged').removeClass('tagged tag-red tag-ink').forEach(node => { node.removeData('tag'); });
    for (const tag of targets?.tags || []) {
      const node = this.cy.getElementById(tag.id);
      if (node.nonempty()) node.data('tag', tag.text).addClass(`tagged tag-${tag.tone}`);
    }
    this.drawProbes();
  }
  private end(id?: string): ProbeEnd | null {
    if (!id) return null;
    const node = this.cy.getElementById(id);
    if (node.empty() || node.removed()) return null;
    const part = this.cy.getElementById(`c:${node.data('ref')}`);
    const fromAbove = part.nonempty() && node.position().y < part.position().y;
    const at = node.renderedPosition();
    return { x: at.x, y: at.y, fromAbove };
  }
  private drawProbes() {
    const targets = this.probes;
    if (!targets) { this.overlay.innerHTML = ''; return; }
    // Numbered dots for the other problems; neighbouring pins would stack them, so nudge apart.
    const markers: { n: number; x: number; y: number }[] = [];
    for (const marker of targets.markers || []) {
      const node = marker.ids.map(id => this.cy.getElementById(id)).find(n => n.nonempty());
      if (!node) continue;
      const at = node.renderedPosition();
      let x = at.x + 14, y = at.y - 16;
      while (markers.some(m => Math.hypot(m.x - x, m.y - y) < 24)) x += 26;
      markers.push({ n: marker.n, x, y });
    }
    this.overlay.innerHTML = probesSvg(this.end(targets.red), this.end(targets.black), markers, this.cy.zoom());
  }
  clearFocus() {
    this.setProbes(null);
    this.cy.elements().removeClass('active connected selection-muted evidence evidence-muted issue change');
    this.focusStatus.hidden = true;
    this.fit();
  }
  highlightEvidence(result: Pick<Explanation, 'evidence'> | null, mode: 'route' | 'issue' | 'change' = 'route', label = '') {
    this.cy.elements().removeClass('evidence evidence-muted issue change');
    if (!result) return;
    this.cy.elements().removeClass('active connected selection-muted');
    const ids = new Set(result.evidence.nodes.map(n => n.id));
    const memberships = evidenceMemberships(result);
    this.cy.elements().addClass('evidence-muted');
    this.cy.nodes().filter(n => ids.has(n.id())).removeClass('evidence-muted').addClass('evidence');
    const wires = this.cy.edges().filter(e => e.data('kind') === 'wire' &&
      memberships.has(JSON.stringify([e.data('pinId'), `n:${e.data('code')}`])));
    const leads = this.cy.edges().filter(e => e.data('kind') === 'lead' && ids.has(e.data('pinId')));
    wires.union(leads).removeClass('evidence-muted').addClass('evidence');
    wires.union(leads).connectedNodes().removeClass('evidence-muted');
    const refs = new Set(this.cy.nodes().filter(n=>ids.has(n.id()) && n.data('kind')==='pin').map(n=>n.data('ref')));
    this.cy.nodes().filter(n=>n.data('kind')==='component' && refs.has(n.data('ref'))).removeClass('evidence-muted');
    if(mode==='issue') this.cy.elements('.evidence').addClass('issue');
    if(mode==='change') this.cy.elements('.evidence').addClass('change');
    this.setFocusLabel(label || (mode==='issue' ? 'Showing · the problem in red' : 'Showing · the route in dark ink'));
    const focus = this.cy.nodes().filter(n=>ids.has(n.id()) || (n.data('kind')==='component' && refs.has(n.data('ref'))));
    if(focus.length) { this.cy.fit(focus,70); if(this.cy.zoom()>1.2) this.cy.zoom(1.2); }
  }
  search(query:string) {
    this.cy.elements().removeClass('muted match');
    if(!query.trim())return;
    const matches=this.cy.nodes().filter(n=>(n.data('search')||'').includes(query.toLowerCase()));
    this.cy.elements().addClass('muted');matches.addClass('match').removeClass('muted');
    matches.neighborhood().removeClass('muted');
    const refs=new Set(matches.map(n=>n.data('ref')).filter(Boolean));
    this.cy.elements().filter(e=>refs.has(e.data('ref'))).removeClass('muted');
  }
  zoomBy(amount:number) {this.userViewport=true;this.cy.zoom({level:this.cy.zoom()*amount,renderedPosition:{x:this.cy.width()/2,y:this.cy.height()/2}});}
  resetLayout() {
    this.arrangement.clear();
    this.cy.batch(() => this.initial.forEach((position, id) => this.cy.getElementById(id).position(position)));
    this.fit();
  }
  fit(){this.userViewport=false;this.cy.resize();this.cy.fit(undefined,35);}
  destroy(){this.observer.disconnect();this.focusStatus.remove();this.overlay.remove();this.cy.destroy();}
}
