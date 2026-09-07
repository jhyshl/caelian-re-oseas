const excluded = new Set(['catalog','cardCatalog','controller','playerController','action','events','trace','choose']);

/** Preserve graph identity, Map/Set and infinite trigger budgets through JSON exports. */
export function encode(value) {
  const nodes = [], seen = new Map();
  function visit(v) {
    if (typeof v === 'number' && !Number.isFinite(v)) return {$number:String(v)};
    if (v === undefined) return {$undefined:true};
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return {$ref:seen.get(v)};
    const id = nodes.length;
    seen.set(v,id);
    const node = {type:Array.isArray(v)?'array':v instanceof Map?'map':v instanceof Set?'set':'object', value:null};
    nodes.push(node);
    node.value = v instanceof Map ? [...v].map(([k,x])=>[visit(k),visit(x)]) : v instanceof Set ? [...v].map(visit) : Array.isArray(v) ? v.map(visit) : Object.fromEntries(Object.entries(v).filter(([k,x])=>typeof x!=='function'&&!(v===value&&excluded.has(k))&&!(k==='catalog'&&x instanceof Map)).map(([k,x])=>[k,visit(x)]));
    return {$ref:id};
  }
  const root = visit(value);
  return {version:2,root,nodes};
}

export function decode(data) {
  if (data?.version !== 2 || !Array.isArray(data.nodes)) throw Error('战斗存档版本不受支持');
  const values = data.nodes.map(n=>n.type==='array'?[]:n.type==='map'?new Map():n.type==='set'?new Set():{});
  const read = v=>v&&typeof v==='object'?('$ref' in v?values[v.$ref]:'$number' in v?Number(v.$number):'$undefined' in v?undefined:v):v;
  data.nodes.forEach((n,i)=>{
    const dst=values[i];
    if(n.type==='array') dst.push(...n.value.map(read));
    else if(n.type==='map') for(const [k,v] of n.value) dst.set(read(k),read(v));
    else if(n.type==='set') n.value.forEach(v=>dst.add(read(v)));
    else for(const [k,v] of Object.entries(n.value)) dst[k]=read(v);
  });
  return read(data.root);
}
