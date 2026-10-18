import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { componentKind, displayValue, visibleNets, netLabel, pinName, type Circuit, type Selection } from './types';
import { circuitArt } from './circuit-art';
import { boardDrawing } from './board-art';
import { partDrawing, groundImage, isGroundNet } from './part-art';
import { evidenceMemberships, type Explanation } from './explanation';
import { simpleWireRoute } from './wire-routing';
import { connectionFocus } from './graph-focus';

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
    const positions = new Map<string,{x:number;y:number;width:number;height:number}>();
    for(const component of circuit.components) {
      const level = levels.get(component.ref) ?? 1;
      const pins = nets.flatMap(n=>n.nodes.filter(p=>p.ref===component.ref));
      const board = componentKind(component)==='board';
      const height = drawings.get(component.ref)?.height ?? Math.max(140,Math.ceil(pins.length/2)*28+55);
      const previous = circuit.components.filter(c=>positions.has(c.ref) && (levels.get(c.ref)??1)===level);
      const y = previous.reduce((total,c)=>total+positions.get(c.ref)!.height+120,0)+height/2;
      positions.set(component.ref,{x:level*700,y:Math.max(y,200),width:drawings.get(component.ref)?.width ?? 180,height});
    }
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
      const color = ground(net) ? '#697e8c' : ['#b48736','#4f91a3','#8271ab','#5b936e','#b57362','#5781ae'][index%6];
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
          label:'data(label)','font-size':14,'font-weight':600,color:'#304e45','text-valign':'bottom','text-margin-y':16,
          'text-max-width':'280px','text-wrap':'wrap','overlay-opacity':0,'bounds-expansion':6}},
        {selector:'node[kind = "pin"]',style:{width:7,height:7,'background-color':'#fbfdfc','border-width':2,'border-color':'#607f72',
          label:'data(label)','font-size':12,color:'#425e52','text-valign':'top','text-margin-y':-7,'text-background-color':'#fbfdfc',
          'text-background-opacity':0.94,'text-background-padding':'2px','overlay-opacity':0,'z-index':10}},
        {selector:'node[board = "yes"]',style:{width:9,height:9,'background-color':'#ffdc7b','border-color':'#fff0bc','border-width':2}},
        {selector:'node[kind = "bend"]',style:{width:10,height:10,'background-color':'#fcfdfc','border-color':'#168673','border-width':1.5,'overlay-opacity':0,'z-index':10,opacity:0}},
        {selector:'node[kind = "anchor"]',style:{width:1,height:1,opacity:0,events:'no'}},
        {selector:'node[kind = "net"]',style:{width:6,height:6,'background-color':'data(color)',label:'',
          'font-size':13,color:'#425e52','text-valign':'top','text-margin-y':-8,'text-background-color':'#fbfdfc',
          'text-background-opacity':1,'text-background-padding':'4px','overlay-opacity':0}},
        {selector:'node[ground = "yes"]',style:{width:32,height:28,'background-image':'data(image)','background-fit':'contain','background-opacity':0,'border-width':0}},
        {selector:'node[single = "yes"]',style:{'background-color':'#d09b40','border-width':2,'border-color':'#b5832d'}},
        {selector:'edge',style:{width:3,'line-color':'data(color)','curve-style':'taxi','taxi-direction':'auto','taxi-turn':'50%','taxi-turn-min-distance':0,'source-endpoint':'outside-to-node','target-endpoint':'outside-to-node','overlay-opacity':0}},
        {selector:'edge[kind = "lead"]',style:{'curve-style':'straight',width:2}},
        {selector:'.active',style:{'border-width':2,'border-color':'#16836b'}},
        {selector:'.selection-muted',style:{opacity:0.2}},
        {selector:'node.connected',style:{'border-color':'#168673','border-width':2}},
        {selector:'edge.connected',style:{width:3.5,'line-color':'#168673','z-index':5}},
        {selector:'node[kind = "bend"].connected',style:{opacity:1}},
        {selector:'node[kind = "net"].active',style:{label:'data(label)'}},
        {selector:'.muted',style:{opacity:0.18}},
        {selector:'.evidence-muted',style:{opacity:0.16}},
        {selector:'node.evidence',style:{'border-width':3,'border-color':'#2874db',opacity:1}},
        {selector:'edge.evidence',style:{width:4,'line-color':'#2874db',opacity:1,'z-index':6}},
        {selector:'node.issue',style:{'border-width':3,'border-color':'#d38a16',opacity:1}},
        {selector:'node[kind = "pin"].issue',style:{width:15,height:15,'background-color':'#ffdfa2','border-width':3}},
        {selector:'edge.issue',style:{'line-color':'#d38a16'}},
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
    this.focusStatus = document.createElement('div');
    this.focusStatus.className = 'canvas-focus';
    this.focusStatus.hidden = true;
    this.focusStatus.setAttribute('role','status');
    container.parentElement!.append(this.focusStatus);
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
  clearFocus() {
    this.cy.elements().removeClass('active connected selection-muted evidence evidence-muted issue');
    this.focusStatus.hidden = true;
    this.fit();
  }
  highlightEvidence(result: Pick<Explanation, 'evidence'> | null, mode: 'route' | 'issue' = 'route') {
    this.cy.elements().removeClass('evidence evidence-muted issue');
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
    this.setFocusLabel(mode==='issue' ? 'Possible issue · Highlighted in amber' : 'Connection evidence · Highlighted in blue');
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
  zoomBy(amount:number) {this.cy.zoom({level:this.cy.zoom()*amount,renderedPosition:{x:this.cy.width()/2,y:this.cy.height()/2}});}
  resetLayout() {
    this.arrangement.clear();
    this.cy.batch(() => this.initial.forEach((position, id) => this.cy.getElementById(id).position(position)));
    this.fit();
  }
  fit(){this.cy.resize();this.cy.fit(undefined,35);}
  destroy(){this.observer.disconnect();this.focusStatus.remove();this.cy.destroy();}
}
