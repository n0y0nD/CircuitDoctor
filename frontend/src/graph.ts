import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { componentKind, displayValue, isUnused, netLabel, pinName, type Circuit, type Selection } from './types';
import { circuitArt } from './circuit-art';
import { boardDrawing } from './board-art';
import { evidenceMemberships, type Explanation } from './explanation';

const colors = ['#168673', '#517caf', '#ac7c36', '#8e6eb0', '#458c98', '#ad6676'];
type Point = { x: number; y: number };
// Keep manual arrangements while switching tabs, scoped to each uploaded circuit.
const arrangements = new Map<string, Map<string, Point>>();

const pinId = (ref: string, pin: string) => `p:${JSON.stringify([ref,pin])}`;

export class CircuitGraph {
  private cy: Core;
  private observer: ResizeObserver;
  private initial = new Map<string, Point>();
  private arrangement: Map<string, Point>;
  constructor(container: HTMLElement, circuit: Circuit, showUnused: boolean,
    onSelect: (selection: Selection) => void, onZoom: (value: number) => void) {
    const key = circuit.storage.circuit_id;
    this.arrangement = arrangements.get(key) || new Map();
    arrangements.set(key, this.arrangement);
    if (arrangements.size > 20) arrangements.delete(arrangements.keys().next().value!);
    const nets = circuit.nets.filter(n => showUnused || !isUnused(n));
    const root = circuit.components.find(c => componentKind(c) === 'board') || circuit.components[0];
    const ground = (name: string) => /^(GND|GROUND|VSS)$/i.test(name.replace(/^\//,''));
    // Connectivity determines placement; shared ground does not flatten every component into one column.
    const levels = new Map<string,number>();
    if(root) levels.set(root.ref,0);
    for(let pass=0;pass<circuit.components.length;pass++) {
      let changed = false;
      for(const net of nets.filter(n=>!ground(n.name))) {
        const known = net.nodes.map(p=>levels.get(p.ref)).filter((v):v is number=>v!==undefined);
        if(!known.length) continue;
        const next = Math.min(...known)+1;
        for(const pin of net.nodes) if(!levels.has(pin.ref)) {levels.set(pin.ref,next);changed=true;}
      }
      if(!changed) break;
    }
    const drawings = new Map(circuit.components.filter(c=>componentKind(c)==='board').map(c=>[c.ref,boardDrawing(circuit,c)]));
    const positions = new Map<string,{x:number;y:number;width:number;height:number}>();
    for(const component of circuit.components) {
      const level = levels.get(component.ref) ?? 1;
      const pins = nets.flatMap(n=>n.nodes.filter(p=>p.ref===component.ref));
      const board = componentKind(component)==='board';
      const height = board ? drawings.get(component.ref)!.height : Math.max(140,Math.ceil(pins.length/2)*28+55);
      const previous = circuit.components.filter(c=>positions.has(c.ref) && (levels.get(c.ref)??1)===level);
      const y = previous.reduce((total,c)=>total+positions.get(c.ref)!.height+100,0)+height/2;
      positions.set(component.ref,{x:level*440,y:Math.max(y,170),width:board?drawings.get(component.ref)!.width:180,height});
    }
    const elements: ElementDefinition[] = [];
    const portSides = new Map<string, number>();
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
          const incoming = pins.findIndex(p=>!ground(p.net.name) && p.net.nodes.some(n=>n.ref!==component.ref && positions.get(n.ref)!.x<pos.x));
          const firstSignal = pins.findIndex(p=>!ground(p.net.name));
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
        const name = pinName(circuit,pin);
        elements.push({data:{id,kind:'pin',ref:pin.ref,pin:pin.pin,code:net.code,
          label:board?'':name===`Pin ${pin.pin}`?name:`${pin.pin} · ${name}`,board:board?'yes':'no',
          search:`${pin.ref} ${pin.pin} ${name}`.toLowerCase()},position:{x,y}});
        if (board) return; // The wire starts on the illustrated socket itself.
        // Short leads attach each exported pin to its own component. They are not electrical shorts.
        const anchor = `a:${id}`;
        elements.push({data:{id:anchor,kind:'anchor',ref:pin.ref,search:''},position:{x:pos.x+(side==='left'?-1:1)*pos.width/2,y}});
        elements.push({data:{id:`lead:${id}`,source:anchor,target:id,kind:'lead',ref:pin.ref,pinId:id,color:'#8b9b9d'}});
      });
    }
    const bottom = Math.max(0,...Array.from(positions.values()).map(p=>p.y+p.height/2))+85;
    nets.forEach((net,index)=>{
      const points = net.nodes.map(p=>ports.get(pinId(p.ref,p.pin))!).filter(Boolean);
      const x = points.reduce((sum,p)=>sum+p.x,0)/Math.max(points.length,1);
      const y = ground(net.name) ? bottom+index*8 : points.reduce((sum,p)=>sum+p.y,0)/Math.max(points.length,1)-55-(index%3)*23;
      const color = ground(net.name)?'#647982':colors[index%colors.length];
      elements.push({data:{id:`n:${net.code}`,kind:'net',code:net.code,label:netLabel(net),
        single:net.nodes.length===1?'yes':'no',color,search:net.name.toLowerCase()},position:{x,y}});
      net.nodes.forEach((pin,pinIndex)=>{
        const source = pinId(pin.ref,pin.pin);
        const point = ports.get(source)!;
        const side = portSides.get(source)!;
        const key = JSON.stringify([net.code,pin.ref,pin.pin]);
        const exit = `exit:${key}`, bend = `bend:${key}`;
        const outside = point.x + side*(55+pinIndex*14);
        // First leave the socket sideways. The open circle is a freely movable wire bend.
        elements.push({data:{id:exit,kind:'anchor',ref:pin.ref,code:net.code,search:''},position:{x:outside,y:point.y}});
        elements.push({data:{id:bend,kind:'bend',ref:pin.ref,code:net.code,color,search:net.name.toLowerCase()},position:{x:outside,y}});
        [[source,exit],[exit,bend],[bend,`n:${net.code}`]].forEach(([from,to],segment)=>elements.push({
          data:{id:`e:${key}:${segment}`,source:from,target:to,kind:'wire',code:net.code,ref:pin.ref,pinId:source,color}}));
      });
    });
    this.cy = cytoscape({container,elements,layout:{name:'preset'},minZoom:0.06,maxZoom:3,
      boxSelectionEnabled:false,autounselectify:true,autoungrabify:false,
      style:[
        {selector:'node[kind = "component"]',style:{shape:'round-rectangle',width:'data(width)',height:'data(height)',
          'background-image':'data(image)','background-fit':'contain','background-opacity':0,'border-width':0,
          label:'data(label)','font-size':14,'font-weight':600,color:'#304e45','text-valign':'bottom','text-margin-y':16,
          'text-max-width':'280px','text-wrap':'wrap','overlay-opacity':0,'bounds-expansion':6}},
        {selector:'node[kind = "pin"]',style:{width:7,height:7,'background-color':'#fbfdfc','border-width':2,'border-color':'#607f72',
          label:'data(label)','font-size':12,color:'#425e52','text-valign':'top','text-margin-y':-7,'text-background-color':'#fbfdfc',
          'text-background-opacity':0.94,'text-background-padding':'2px','overlay-opacity':0,'z-index':10}},
        {selector:'node[board = "yes"]',style:{width:9,height:9,'background-color':'#ffdc7b','border-color':'#fff0bc','border-width':2}},
        {selector:'node[kind = "bend"]',style:{width:11,height:11,'background-color':'#fcfdfc','border-color':'data(color)','border-width':1.5,'overlay-opacity':0,'z-index':10}},
        {selector:'node[kind = "anchor"]',style:{width:1,height:1,opacity:0,events:'no'}},
        {selector:'node[kind = "net"]',style:{width:9,height:9,'background-color':'data(color)',label:'data(label)',
          'font-size':13,color:'#425e52','text-valign':'top','text-margin-y':-8,'text-background-color':'#fbfdfc',
          'text-background-opacity':1,'text-background-padding':'4px','overlay-opacity':0}},
        {selector:'node[single = "yes"]',style:{'background-color':'#d09b40','border-width':2,'border-color':'#b5832d'}},
        {selector:'edge',style:{width:2,'line-color':'data(color)','curve-style':'straight','source-endpoint':'outside-to-node','target-endpoint':'outside-to-node','overlay-opacity':0}},
        {selector:'edge[kind = "lead"]',style:{'curve-style':'straight',width:2}},
        {selector:'.active',style:{'border-width':2,'border-color':'#16836b'}},
        {selector:'edge.connected',style:{width:4,'z-index':5}},
        {selector:'.muted',style:{opacity:0.18}},
        {selector:'.evidence-muted',style:{opacity:0.16}},
        {selector:'node.evidence',style:{'border-width':3,'border-color':'#13856e',opacity:1}},
        {selector:'edge.evidence',style:{width:4,'line-color':'#13856e',opacity:1,'z-index':6}},
        {selector:'.match',style:{'border-width':3,'border-color':'#16836b',opacity:1}},
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
    this.cy.on('dbltap','node[kind = "component"]',event=>this.cy.fit(event.target,30));
    this.cy.on('tap','edge[kind = "wire"]',event=>onSelect({kind:'net',id:event.target.data('code')}));
    this.cy.on('mouseover','node, edge[kind = "wire"]',()=>{container.style.cursor='grab';});
    this.cy.on('mouseout','node, edge',()=>{container.style.cursor='grab';});
    this.cy.on('zoom',()=>onZoom(Math.round(this.cy.zoom()*100)));
    let size = { width: container.clientWidth, height: container.clientHeight };
    this.observer = new ResizeObserver(() => {
      const next = { width: container.clientWidth, height: container.clientHeight };
      if (next.width === size.width && next.height === size.height) return;
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
    this.cy.elements().removeClass('active connected');
    if(!selection)return;
    this.cy.getElementById(selection.kind==='pin' ? selection.id : `${selection.kind==='component'?'c':'n'}:${selection.id}`).addClass('active');
    if(selection.kind==='component') this.cy.edges().filter(e=>e.data('ref')===selection.id).addClass('connected');
    else if(selection.kind==='net') this.cy.edges().filter(e=>e.data('code')===selection.id).addClass('connected');
    else this.cy.edges().filter(e=>e.data('pinId')===selection.id).addClass('connected');
    if(selection.kind==='net') this.cy.nodes().filter(n=>n.data('code')===selection.id && n.data('kind')==='bend').addClass('active');
  }
  highlightEvidence(result: Explanation | null) {
    this.cy.elements().removeClass('evidence evidence-muted');
    if (!result) return;
    const ids = new Set(result.evidence.nodes.map(n => n.id));
    const memberships = evidenceMemberships(result);
    this.cy.elements().addClass('evidence-muted');
    this.cy.nodes().filter(n => ids.has(n.id())).removeClass('evidence-muted').addClass('evidence');
    const wires = this.cy.edges().filter(e => e.data('kind') === 'wire' &&
      memberships.has(JSON.stringify([e.data('pinId'), `n:${e.data('code')}`])));
    const leads = this.cy.edges().filter(e => e.data('kind') === 'lead' && ids.has(e.data('pinId')));
    wires.union(leads).removeClass('evidence-muted').addClass('evidence');
    wires.union(leads).connectedNodes().removeClass('evidence-muted');
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
  zoomBy(amount:number) {this.cy.zoom({level:this.cy.zoom()*amount,renderedPosition:{x:this.cy.width()/2,y:this.cy.height()/2}});}
  resetLayout() {
    this.arrangement.clear();
    this.cy.batch(() => this.initial.forEach((position, id) => this.cy.getElementById(id).position(position)));
    this.fit();
  }
  fit(){this.cy.resize();this.cy.fit(undefined,35);}
  destroy(){this.observer.disconnect();this.cy.destroy();}
}
